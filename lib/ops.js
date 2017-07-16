/*
 * Fuse operations for cachejs
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

const debug = require('debug')('cachejs:ops')
    , thenify = require('thenify')
    , fs = require('fs-extra')

    , readdir = thenify(fs.readdir)
    , access = thenify(fs.access)
    , lstat = thenify(fs.lstat)
    , readlink = thenify(fs.readlink)

    , options = require('./options')
    , PassthruFile = require('./passthru')
    , CacheFile = require('./cachefile')
    , worker = require('./worker')
    , cache = require('./cache')
    ;

// the root of the underlying filesystem
var root = options.source;


var ops = {

/*
 * start & stop
 */
    async init() {
        debug('init');
        worker.push('Initial load', cache.load)
    },

    async destroy() {
        debug('destroy');
        await worker.stop();
    },

/*
 * getting information
 */

    async readdir(path) {
    //    debug('readdir %s', path);
        return await readdir(root + path);
    },

    async access(path, mode) {
        debug('access %s, %s', path, mode);
        return await access(root + path, mode);
    },

    async getattr(path) {
    //    debug('getattr %s', path);
        return await lstat(root + path);
    },

    async readlink(path) {
        debug('readlink %s', path);
        return await readlink(root + path);
    },

/*
 * File I/O
 */
    async open(path, flags) {
        var file;
        debug('open %s, %s', path, flags);
        if ((flags & 3) !== 0) {
            let err = new Error('Read only file system');
            err.code = 'EROFS';
            throw err;
        }

        if (options.filter(path)) {
            file = new CacheFile(options.source, options.cache, path);
        } else {
            file = new PassthruFile(options.source, path);
        }
        debug('file = %o', file);
        debug('file.open = %o', file.open);
        await file.open();
        return file;
    },

    async read(file, buffer, length, position) {
        debug('read %o, %d bytes from %d', file, length, position);
        return await file.read(buffer, length, position);
    },


    async release(file) {
        debug('release %o', file);
        await file.close();
    }
};

module.exports = exports = ops;





