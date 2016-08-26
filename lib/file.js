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
  , pevent = require('./pevent')

  , openFile = Promise.promisify(fs.open)
  , readFile = Promise.promisify(fs.read)
  , closeFile = Promise.promisify(fs.close)
  ;

// the roots of the underlying filesystems
var root = Path(options.source);


/*
 * PassthruFile
 *
 * Simple passthru mechanism
 *
 */

class PassthruFile{
    constructor(path) {
        this.path = Path(path);
        this.fd = null;
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
        if (!options.filter(path + '')) {
            return new PassthruFile(path + '');    // not a cacheable file
        }

        debug('creating cachefile for %s', path);
        this.path = Path(path);
        this.fd = null;
        this.closed = false;
    }

    inspect() {
        return 'CacheFile(' + this.path + ')';
    }

    /*Promise*/ open() {
        // try opening the cache version first
        return cache.find(this.path)
        .then(e => {
            // if not cached, then ask for it to be loaded
            if (!e.cached) {
                cache.requestLoad(this.path);

                // once loaded, then switch to the new file, if we are
                // still open and there is a cache file
                pevent.on(this.path, 'loaded', () => {
                    return cache.find(this.path, {noref: true})
                    .then(e => {
                        if (e && e.cached && e.file
                                && !this.closed && this.fd)
                            return this.switchToFile(e.file);
                    });
                });
            }
            debug('opening %s', e.file);
            return openFile(e.file + '','r')
            .then(fd => {
                this.fd = fd;
            });

        });
    }

    /*Promise*/ read(buffer, length, position) {
        debug('reading from %o, %d bytes from %d', this, length, position);
        return readFile(this.fd, buffer, 0, length, position);
    }

    /*Promise*/ switchToFile(file) {
        /* called to switch FDs to the cache version.
         * have to do this carefully in case the file gets closed
         * as we are doing it
         */
        debug('switching to %s', file);
        // open the new file
        return openFile(file + '', 'r')
        .then(newfd => {
            // bomb out if already closed
            if (this.closed)
                return closeFile(newfd);

            // switch fds, and close the old one
            var oldfd = this.fd;
            this.fd = newfd;
            return closeFile(oldfd);
        });
    }

    /*Promise*/ close() {
        this.closed = true;
        return cache.release(this.path)
        .then(() => closeFile(this.fd));
    }
}


exports = module.exports = CacheFile;
exports.start = () => cache.start();
exports.stop = () => cache.stop();


