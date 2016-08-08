/*
 * Fuse operations for cachejs
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:ops')
  , fuse = require('fuse-bindings')
  , pixfuse = require('./pixfuse')
  , fs = require('fs-extra')
  , options = require('./options')
  , File = require('./file')
  ;

// the root of the underlying filesystem
var root = options.source.toString();

function dieOnError(err) {
    console.error('uncaught rejection: ' + err +
            (err.stack ? '\n'+err.stack : ''));
    process.exit(1);
}

var ops = {

/*
 * start & stop
 */
    init(cb) {
        debug('init');
        File.start();
        cb(null);
    },

    destroy(cb) {
        debug('destroy');
        File.stop()
        .catch(dieOnError)
        .asCallback(cb);
    },

/*
 * getting information
 */

    readdir(path, cb) {
        debug('readdir %s', path);
        fs.readdir(root + path, cb);
    },

    access(path, mode, cb) {
        debug('access %s, %s', path, mode);
        fs.access(root + path, mode, cb);
    },

    getattr(path, cb) {
        debug('getattr %s', path);
        fs.lstat(root + path, cb);
    },

    readlink(path, cb) {
        debug('readlink %s', path);
        fs.readlink(root + path, cb);
    },

/*
 * File I/O
 */
    open(path, flags, cb) {
        var file;
        debug('open %s, %s', path, flags);
        if ((flags & 3) !== 0) {
            return cb(fuse.EROFS); // can only cope with read-only opens
        }

        file = new File(root + path);
        file.open()
        .then(() => file)
        .asCallback(cb);
    },


    read(file, buffer, length, position, cb) {
        debug('read %s, %d bytes from %d', file, length, position);
        return file.read(buffer, length, position)
        .asCallback(cb);
    },


    release(file, cb) {
        debug('release %o', file);
        return file.close()
        .asCallback(cb);
    }
};


pixfuse(ops);
module.exports = exports = ops;





