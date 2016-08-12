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
  , Cache = require('./cache')

  , openFile = Promise.promisify(fs.open)
  , readFile = Promise.promisify(fs.read)
  , closeFile = Promise.promisify(fs.close)
  ;

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
    constructor(source) {
        source = Path(source);
        debug('creating passthru for %s', source);
        this.filename = source;
        return this;
    }

    inspect() {
        return 'PassthruFile(' + this.filename + ')';
    }

    /*Promise*/ open() {
        debug('opening %s', this.filename);
        return openFile(this.filename.path, 'r')
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
 * uses a cache. each file object has an entry in the cache
 * non-cacheable files result in vanilla passthru objects
 */

var cache = new Cache({
    dir: options.cachedir,
    maxsize: options.cachesize,
    maxage: options.timeout
});


class CacheFile {
    constructor(path) {
        var entry;
        path = Path(path);
        entry = cache.find(path);

        if(!entry) {
            // not cacheable - fallback to passthru
            return new PassthruFile(path);
        }

        debug('creating cachefile for %s', path);
        this.entry = entry;
        this.closed = false;
    }

    inspect() {
        return 'CacheFile(' + this.entry.path + ')';
    }

    /*Promise*/ open() {
        this.entry.attach(this);

        var file = this.entry.isCached() ?
                this.entry.cachefile : this.entry.path;
        return openFile(file.path, 'r')
            .then(fd => { this.fd = fd; });
    }

    /*Promise*/ read(buffer, length, position) {
        return readFile(this.fd, buffer, 0, length, position);
    }

    /*Promise*/ switchToCached() {
        /* called to switch FDs to the cache version.
         * have to do this carefully in case the file gets closed
         * as we are doing it
         */
        if (this.closed || !this.fd) // closed or not yet open - do nothing
            return Promise.resolve();

        debug('switching from %s to %s', this.entry.path, this.entry.cachefile);
        return openFile(this.entry.cachefile.path, 'r')
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
        this.closed = true;
        return closeFile(this.fd)
            .then(() => this.entry.release(this));
    }
}


exports = module.exports = CacheFile;
exports.start = () => cache.start();
exports.stop = () => cache.stop();


