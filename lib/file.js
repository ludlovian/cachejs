/*
 * File objects
 *
 * Passthru file is a simple version
 *
 * CacheFile is cacheable
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:file')
  , fs = require('fs-extra')
  , Path = require('pathlib')
  , options = require('./options')
  , Promise = require('pixpromise')
  , cache = require('./cache')

  , openFile = Promise.promisify(fs.open)
  , readFile = Promise.promisify(fs.read)
  , closeFile = Promise.promisify(fs.close)
  ;

// the roots of the underlying filesystems
var root = Path(options.source);
var cacheroot = Path(options.cachedir);

function dieOnError(err) {
    console.error('uncaught rejection: ' + err +
            (err.stack ? '\n'+err.stack : ''));
    process.exit(1);
}


/*
 * PassthruFile
 *
 * Simple passthru mechanism
 *
 */

class PassthruFile{
    constructor(path) {
        this.path = Path(path);
        debug('creating passthru for %s', this.path);
    }

    inspect() {
        return 'PassthruFile(' + this.path + ')';
    }

    /*Promise*/ open() {
        debug('opening %s', this.path);
        var f = root.join(this.path) + '';
        return openFile(f, 'r')
        .then(fd => { this.fd = fd; });
    }

    /*Promise*/ read(buffer, length, position) {
        return readFile(this.fd, buffer, 0, length, position);
    }

    /*Promise*/ close() {
        return closeFile(this.fd);
    }
}

/* CacheFile
 *
 * uses a cached version if it exists. Tells the cache about my usage
 * so that it can cache the files if it wants.
 *
 * Can swtich files midstream if cached
 */


class CacheFile {
    constructor(path) {
        path = this.path = Path(path);

        if (!options.filter(this.path.path)) {
            return new PassthruFile(this.path);    // not a cacheable file
        }

        debug('creating cachefile for %s', path);
        this.closed = false;
    }

    inspect() {
        return 'CacheFile(' + this.path + ')';
    }

    /*Promise*/ open() {
        // try opening the cache version first
        return this._openCached()
        .catch(err => {
            // doesn't exist? try the underying source
            if (!err || err.code !== 'ENOENT')
                throw err;
            return this._openSource();
        });
    }

    /*Promise*/ _openCached() {
        debug('trying to open cached version');
        return openFile(cacheroot.join(this.path) + '', 'r')
        .then(fd => {
            this.fd = fd;
            cache.register(this.path, this, true);
        });
    }

    /*Promise*/ _openSource() {
        debug('opening underlying version');
        return openFile(root.join(this.path) + '', 'r')
        .then(fd => {
            this.fd = fd;
            cache.register(this.path, this, false);
        });
    }

    /*Promise*/ read(buffer, length, position) {
        debug('reading from %o, %d bytes from %d', this, length, position);
        return readFile(this.fd, buffer, 0, length, position);
    }

    /*Promise*/ switchToFile(newFile) {
        /* called to switch FDs to the cache version.
         * have to do this carefully in case the file gets closed
         * as we are doing it
         */
        if (this.closed || !this.fd) // closed or not yet open - do nothing
            return Promise.resolve();

        debug('switching to %s', newFile);
        return openFile(newFile + '', 'r')
        .then( newfd => {
            var oldfd;
            if (this.closed)
                return closeFile(newfd);

            oldfd = this.fd;
            this.fd = newfd;

            return closeFile(oldfd);
        });
    }

    /* On close, if the entry is still queued, then we delete it */
    /*Promise*/ close() {
        debug('closing');
        this.closed = true;
        cache.unregister(this.path, this);
        return closeFile(this.fd);
    }
}


exports = module.exports = CacheFile;
exports.start = () => cache.start();
exports.stop = () => cache.stop();


