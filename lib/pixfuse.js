/*
 * pixfuse
 *
 * Handy fuse wrapper
 *
 * fuse-binding requirements:
 * - API has (path, fd, ...) for file related calls
 * - callback (mostly) requires (errnum, data), where errnum <= 0
 * - requires virtual FDs to be given out and re-mapped
 *
 * This wrapper allows ops to be written which:
 * - receives a fileObject on open/create and attaches a virtual FD
 * - passes (fileObj,...) on file related APIs
 * - final callback accepts node-style (error, data), including read/write
 *
 *
 * you write your ops object, and convert by running it through the wrapper
 * exported
 *
 *  var pixfuse=require('./pixfuse');
 *  ops = { ... };
 *  pixfuse(ops);
 *
 * That's it!
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:pixfuse')
  , fuse = require('fuse-bindings')
  ;


var methods = {
/*
 * Methods which just need callbacks adjusting
 */
  callback: [
      'init'        /* cb */
    , 'access'      /* path, mode cb */
    , 'statfs'      /* path, cb */
    , 'getattr'     /* path, cb */
    , 'readdir'     /* path, cb */
    , 'truncate'    /* path, size, cb */
    , 'readlink'    /* path, cb */
    , 'chown'       /* path, uid, gid, cb */
    , 'chmod'       /* path, mode, cb */
    , 'mknod'       /* path, mode, dev, cb */
    , 'setxattr'    /* path, name, buffer, length, offset, flags, cb */
    , 'getxattr'    /* path, name, buffer, length, offset, cb */
    , 'utimens'     /* path, atime, mtime, cb */
    , 'unlink'      /* path, cb */
    , 'rename'      /* src, dest, cb */
    , 'link'        /* src, dest, cb */
    , 'symlink'     /* src, dest, cb */
    , 'mkdir'       /* path, mode, cb */
    , 'rmdir'       /* path, cb */
    , 'destroy'     /* cb */
    ],

/*
 * Methods which need to resolve (path, fd, ...) into (fileObj, ...)
 */
  resolveFD: [
      'fgetattr'    /* path, fd, cb */
    , 'flush'       /* path, fd, cb */
    , 'fsync'       /* path, fd, datasync, cb */
    , 'fsyncdir'    /* path, fd, datasync, cb */
    , 'ftruncate'   /* path, fd, size, cb */
    ],

/*
 * Methods which convert returned fileObj to virtual FD
 */
  open: [
      'open'        /* path, flags, cb */
    , 'opendir'     /* path, flags, cb */
    , 'create'      /* path, mode, cb */
    ],

/*
 * Methods which return byte count OR error in the callback
 */

  readwrite: [
      'read'        /* path, fd, buffer, length, position, cb */
    , 'write'       /* path, fd, buffer, length, position, cb */
    ],

/*
 * Methods which release an FD
 */
  close: [
      'release'     /* path, fd, cb */
    , 'releasedir'  /* path, fd, cb */
    ],
};

function wrap(ops) {
    var method;

    // callback - adjust callback
    for (method of methods.callback) {
        if (typeof ops[method] === 'function') {
            ops[method] = wrapCallback(ops[method], ops);
        }
    }

    // resolveFD - convert (path, fd,...) to (fileObj, ...) and do callback
    for (method of methods.resolveFD) {
        if (typeof ops[method] === 'function') {
            ops[method] = wrapResolveFD(
                    wrapCallback(ops[method], ops));
        }
    }

    // open - convert returned file obj to new virtual fd
    for (method of methods.open) {
        if (typeof ops[method] === 'function') {
            ops[method] = wrapOpen(
                    wrapCallback(ops[method], ops));
        }
    }

    // readwrite - return #bytes in callback
    for (method of methods.readwrite) {
        if (typeof ops[method] === 'function') {
            ops[method] = wrapBytes(wrapResolveFD(
                    wrapCallback(ops[method], ops)));
        }
    }

    // close - convert (path, fd,...) to (fileObj, ...) and release FD
    for (method of methods.close) {
        if (typeof ops[method] === 'function') {
            ops[method] = wrapClose(wrapResolveFD(
                    wrapCallback(ops[method], ops)));
        }
    }
    debug('ops wrapped');
}

module.exports = exports = wrap;

/*
 * virtual FDs
 *
 */
var fdMap = new Map(); // fd -> file object
var lastFD = 0;
wrap.MAXFD = 1024;

function getNextFD() {
    var i, fd=lastFD;
    for (i=0; i<wrap.MAXFD; i++) {
        fd = (fd % wrap.MAXFD) + 1;
        if (!fdMap.get(fd)) {
            lastFD = fd;
            return fd;
        }
    }
    console.error('Too many files open');
    process.exit(1);
}

/*
 * wrapCallback - adjusts the callback
 * from:
 *      nodeback(errorObject, data)
 * to:
 *      fuseback(errNumber, data)
 */

function wrapCallback(fn, ctx) {
    return function(...args) {
        var cb = args.pop();
        function newCallback(err, data) {
            if(err) {
                if (typeof err === 'number')
                    return cb(err);
                if (err.code in fuse)
                    return cb(fuse[err.code]);
                if (err.errno < 0)
                    return cb(err.errno);
                return cb(-1);
            }
            cb(null, data);
        }

        args.push(newCallback);
        return fn.apply(ctx, args);
    };
}

/* wrapResolveFD - replaces path/fd
 * from:
 *      (path, fd, ...)
 * to:
 *      (fileObj, ...)
 */
function wrapResolveFD(fn, ctx) {
    return function(...args) {
        var cb = args[args.length - 1];
        var path = args.shift();
        var fd = args.shift();
        debug('decoding virtual fd #%d (%s)', fd, path);
        var fdEntry = fdMap.get(fd);
        if(!fdEntry || fdEntry.path !== path) {
            return cb(fuse.EBADFD);
        }
        debug('decoded to %o', fdEntry.file);
        args.unshift(fdEntry.file);
        return fn.apply(ctx, args);
    };
}

/* wrapOpen - allocates new virtual FD
 * from:
 *      (path, ...) -> FD
 * to:
 *      (path, ...) -> fileObj
 *
 */
function wrapOpen(fn, ctx) {
    return function(...args) {
        var file;
        var path = args[0];
        var cb = args.pop();
        function newCallback(err, file) {
            if (err) return cb(err);
            var fd = getNextFD();
            debug('fd #%d assigned for %s', fd, path);
            fdMap.set(fd, {path:path, file:file});
            cb(null, fd);
        }
        args.push(newCallback);
        return fn.apply(ctx, args);
    };
}

/* wrapBytes - replace callback with one of signle param
 * from:
 *      (..., cb(errNumberOrBytes))
 * to:
 *      (...,cb(errNumber, bytes))
 */
function wrapBytes(fn, ctx) {
    return function(...args) {
        var cb = args.pop();
        function newCallback(err, data) {
            var v = err ? err : data;
            debug('returning single param: %s', v);
            cb(v);
        }
        args.push(newCallback);
        return fn.apply(ctx, args);
    };
}

/* wrapClose - removes virtual FD after call
 */
function wrapClose(fn, ctx) {
    return function(...args) {
        var fd = args[1];
        var cb = args.pop();
        function newCallback(err, data) {
            if (err) return cb(err);
            debug('removing object for #%d', fd);
            fdMap.delete(fd);
            return cb(null, data);
        }
        args.push(newCallback);
        return fn.apply(ctx, args);
    };
}
