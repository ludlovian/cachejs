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

require('pixpromise'); // fixup native promise


var debug = require('debug')('cachejs:file')
  , fs = require('fs-extra')
  , Path = require('pathlib')
  , options = require('./options')
  , util = require('./util')
  , log = util.log
  , cache = require('./cache')
  , worker = require('./worker')

  , openFile = Promise.promisify(fs.open)
  , readFile = Promise.promisify(fs.read)
  , closeFile = Promise.promisify(fs.close)
  ;

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
        var f = util.realFile(this.path) + '';
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
        if (!options.filter(path)) {
            return new PassthruFile(path);    // not a cacheable file
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
            // set up a delay to load the file (or siblings)
            log(3, 'ACCESS:   %s', this.path);
            this.alarm = util.alarm(options.loadDelay);
            // if fired then we are using the file (not just dipping in)
            // if cancelled, we ignore
            this.alarm
            .then(() => this.ensureLoaded(),
                    err => null) // swallow alarm cancellation
            .done(); // any residual errors are fatal

            // now we open the file
            let f = util.realFile(this.path, e.cached);
            debug('opening %s', f);
            return openFile(f + '','r')
            .then(fd => {this.fd = fd;});

        });
    }

    /*Promise*/ read(buffer, length, position) {
        debug('reading from %o, %d bytes from %d', this, length, position);
        return readFile(this.fd, buffer, 0, length, position);
    }

    /*Promise*/ close() {
        this.closed = true;
        this.alarm.cancel(); // cancel loader if not fired already
        return closeFile(this.fd);
    }

    /*
     * Called after we have been using a file for a while
     *
     * We check it is cached. If not we schedule a cacheload
     * and switch file after.
     *
     * And we schedule a sibling check to enusre the next few are
     * loaded too.
     *
    /*Promise*/ ensureLoaded() {
        debug('enusreLoaded for %s', this.path);
        return cache.find(this.path)
        .then(e => {
            if (!e.cached) {
                worker.push(() => 
                    cache.loadFile(this.path)
                    .then(loaded => loaded ? this.onLoaded(): null)
                );
            }
            worker.push(()=>cache.siblingCheck(this.path));
        });
    }

    /*Promise*/ onLoaded() {
        debug('onLoaded for %s', this.path);
        return cache.find(this.path)
        .then(e => {
            if (this.closed)
                return;
            if (!e.cached)
                return;
            let f = util.realFile(this.path, e.cached);
            return this.switchToFile(f);
        });
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

}


exports = module.exports = CacheFile;


