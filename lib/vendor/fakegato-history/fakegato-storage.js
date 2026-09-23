/*
 * Vendored from fakegato-history 0.6.7 (https://github.com/simont77/fakegato-history)
 * MIT License, Copyright (c) 2017 simont77, see LICENSE in lib/vendor/fakegato-history.
 * homekit-ccu change: Google-Drive history storage removed (fakegato-storage.js), so the
 * addon tarball does not have to bundle googleapis. Otherwise unchanged.
 */
/*jshint esversion: 6,node: true,-W041: false */
'use strict';

const DEBUG = true;

var fs = require('fs');
var os = require('os');
var path = require('path');
var hostname = os.hostname().split(".")[0];

var fileSuffix = '_persist.json';

var thisStorage;

class FakeGatoStorage {
	constructor(params) {
		if (!params)
			params = {};

		this.writers = [];

		this.log = params.log || {};
		if (!this.log.debug) {
			this.log.debug = DEBUG ? console.log : function () { };
		}
		thisStorage = this;
		this.addingWriter = false;
	}

	addWriter(service, params) {
		if (!this.addingWriter) {
			this.addingWriter = true;
			if (!params)
				params = {};

			this.log.debug("** Fakegato-storage AddWriter :", service.accessoryName);

			let newWriter = {
				'service': service,
				'callback': params.callback,
				'storage': params.storage || 'fs',
				'fileName': params.filename || hostname + "_" + service.accessoryName + fileSuffix		// Unique filename per homebridge server.  Allows test environments on other servers not to break prod.
			};
			var onReady = typeof (params.onReady) == 'function' ? params.onReady : function () { }.bind(this);

			switch (newWriter.storage) {
				case 'fs':
					newWriter.storageHandler = fs;
					newWriter.path = params.path || path.join(os.homedir(), '.homebridge');
					this.writers.push(newWriter);
					this.addingWriter = false;
					onReady();
					break;
				default:
					// homekit-ccu: only 'fs' is supported, Google-Drive storage (and googleapis) was removed
					this.addingWriter = false;
					throw new Error('fakegato-history storage "' + newWriter.storage + '" is not supported by homekit-ccu, use "fs"');
				/*
				case 'memcached' :

				break;
				*/
			}
		} else {
			setTimeout(function () {
				this.addWriter(service, params);
			}.bind(this), 100);
		}
	}
	getWriter(service) {
		let findServ = function (element) {
			return element.service === service;
		};
		return this.writers.find(findServ);
	}
	_getWriterIndex(service) {
		let findServ = function (element) {
			return element.service === service;
		};
		return this.writers.findIndex(findServ);
	}
	getWriters() {
		return this.writers;
	}
	delWriter(service) {
		let index = this._getWriterIndex(service);
		this.writers.splice(index, 1);
	}

	write(params) { // must be asynchronous
		if (!this.writing) {
			this.writing = true;
			let writer = this.getWriter(params.service);
			let callBack = typeof (params.callback) == 'function' ? params.callback : (typeof (writer.callback) == 'function' ? writer.callback : function () { }); // use parameter callback or writer callback or empty function
			switch (writer.storage) {
				case 'fs':
					this.log.debug("** Fakegato-storage write FS file:", path.join(writer.path, writer.fileName), params.data.substr(1, 80));
					writer.storageHandler.writeFile(path.join(writer.path, writer.fileName), params.data, 'utf8', function () {
						this.writing = false;
						callBack(arguments);
					}.bind(this));
					break;
				/*
				case 'memcached' :

				break;
				*/
			}
		} else {
			setTimeout(function () { // retry in 100ms
				this.write(params);
			}.bind(this), 100);
		}
	}
	read(params) {
		let writer = this.getWriter(params.service);
		let callBack = typeof (params.callback) == 'function' ? params.callback : (typeof (writer.callback) == 'function' ? writer.callback : function () { }); // use parameter callback or writer callback or empty function
		switch (writer.storage) {
			case 'fs':
				this.log.debug("** Fakegato-storage read FS file:", path.join(writer.path, writer.fileName));
				writer.storageHandler.readFile(path.join(writer.path, writer.fileName), 'utf8', callBack);
				break;
			/*
			case 'memcached' :

			break;
			*/
		}
	}
	remove(params) {
		let writer = this.getWriter(params.service);
		let callBack = typeof (params.callback) == 'function' ? params.callback : (typeof (writer.callback) == 'function' ? writer.callback : function () { }); // use parameter callback or writer callback or empty function
		switch (writer.storage) {
			case 'fs':
				this.log.debug("** Fakegato-storage delete FS file:", path.join(writer.path, writer.fileName));
				writer.storageHandler.unlink(path.join(writer.path, writer.fileName), callBack);
				break;
			/*
			case 'memcached' :

			break;
			*/
		}
	}
}

module.exports = {
	FakeGatoStorage: FakeGatoStorage
};
