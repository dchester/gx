var gx = function(input, args) {

	var method =
		is_generator(input) ? 'run' :
		input instanceof Function && Object.keys(input.prototype).length ? 'class' :
		input instanceof Function && Object.keys(input).length ? 'keys' :
		input instanceof Function ? 'proxy' : 
		input instanceof Object ? 'keys' : null;

	if (method) return gx[method](input, args);
};

gx.gentrify = gx;

gx.proxy = function(fn) {

	if (fn._gentrified) return;

	var mediator = function() {

		var args = arguments;
		var generatorCaller;

		// hack to discover whether we're in a gnode/regenerator-style generator
		if (
			gnode &&
			mediator.caller.caller &&
			mediator.caller.caller.toString().match(/^function invoke[\s\S]*GenStateExecuting/m)
		) {
			generatorCaller = true;
		}

		if (mediator.caller.constructor.name == 'GeneratorFunction') {
			generatorCaller = true;
		}

		if (!generatorCaller) {
			return fn.apply(this, arguments);
		}

		if (arguments[arguments.length - 1] instanceof Function) {
			return fn.apply(this, arguments);
		}

		return function(callback) {
			args[args.length++] = callback;
			fn.apply(this, args);
		}.bind(this);
	}

	mediator._gentrified = true;

	return mediator;
};

gx.defer = function(fn) {
	fn(gx.resume);
};

gx.fn = function(generator) {

	return function() {

		var args = [];
		var callback = function() {};

		for (var i = 0; i < arguments.length; i++) {
			if (i == arguments.length - 1 && arguments[i] instanceof Function) {
				callback = arguments[i];	
			} else {
				args.push(arguments[i]);
			}
		}

		var context = new Context(generator, args, this);
		context.run(callback);
	};
};

gx.run = function(generator, callback) {

	callback = callback || function() {};

	var context = new Context(generator);
	context.run(callback);
};

gx.keys = function(obj, args) {

	args = args || {};

	var dest = obj;

	Object.keys(obj).forEach(function(key) {

		var prop = obj[key];

		if (is_generator(prop) && args.generators !== false ) {
			dest[key] = gx.proxy(gx.fn(prop));
			return;
		}
	
		if (is_function(prop) && args.functions !== false) {
			 dest[key] = gx.proxy(prop);
			return;
		}

		dest[key] = prop;
	});

	return dest;
};

gx.class = function(klass, args) {

	args = args || {};

	var fn = gx.proxy(klass);

	extend(fn, gx.keys(klass, args));
	extend(fn.prototype, gx.keys(klass.prototype, args));

	return fn;
};

gx.join = null;

Object.defineProperty(gx, 'resume', {
	get: function() {
		var context = contextStack.active();
		return context.resume();
	}
});

var Context = function(generator, args, _this) {

	this.queue = [];
	this.callback = function() {};
	this.pendingCount = 0;
	this.iterator = generator.apply(_this, args);
};

Context.prototype = {

	run: function(callback) {
		this.callback = callback || this.callback;
		this.continue();
	},

	continue: function(payload, err) {

		try {
			contextStack.set(this);

			var ret = err ? 
				this.iterator.throw(err) :
				this.iterator.next(payload);

			var value = ret.value;
			if (ret.done) this.callback(null, value);
			if (ret.done) this._done = true;

			if (is_promise(value)) {
				var callback = this.resume();
				value.then(function(resolution) {
					callback(null, resolution);
				}).catch(callback);
			} else if (value instanceof Function) {
				value.call(null, this.resume());
			}
			contextStack.clear();

		} catch(e) {
			throw e && e.stack ? e.stack : e;
			contextStack.clear();
		}
	},

	resume: function() {
		if (this._done) return;

		var placeholder = {};

		this.pendingCount++;
		this.queue.push(placeholder);

		return function(err, data) {

			if (err) err = new Error(err);

			placeholder.value = data;
			if (--this.pendingCount !== 0) return;

			var len = this.queue.length;

			while (len--) {
				// push a dummy operation onto the next frame of the event loop
				setImmediate(function() {});

				var d = this.queue.shift();
				this.continue(d.value, err);
			}

		}.bind(this);
	}
};

var contextStack = {

	stack: [],

	active: function() {
		return this.stack[this.stack.length - 1]
	},

	set: function(context) {
		this.stack.push(context);
	},

	clear: function() {
		this.stack.pop();
	}
};

function is_function(fn) {

	if (typeof fn != "function") return;
	if (fn.constructor.name != "Function") return;

	return true;
};

function is_generator(fn) {

	if (typeof fn != "function") return;
	if (fn.constructor.name != "GeneratorFunction") return;

	return true;
};

function is_promise(fn) {
	return fn && typeof fn == "object" && typeof fn.then == "function";
};

function extend(obj, source) {
	for (var prop in source) {
		obj[prop] = source[prop];
	}
};

var gnode = 'gnodeJsExtensionCompiler' == require.extensions['.js'].name;

module.exports = gx;

