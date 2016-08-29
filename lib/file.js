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
        return cache.find(this.path, {mru:true})
        .then(e => {
            log(3, '%s   %s',
                    (e.cached ? 'C-READ:' : 'READ:  '), this.path);


            // now we open the file
            let f = util.realFile(this.path, e.cached);
            debug('opening %s', f);
            return openFile(f + '','r')
            .then(fd => {
                this.fd = fd;
                // track opens to see if we should cache
                return onOpen(this);
            });

        });
    }

    /*Promise*/ read(buffer, length, position) {
        debug('reading from %o, %d bytes from %d', this, length, position);
        return readFile(this.fd, buffer, 0, length, position);
    }

    /*Promise*/ close() {
        this.closed = true;
        return closeFile(this.fd)
        .then(() => onClosed(this));
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
        if (this.closed)
            return Promise.resolve();
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

var lastFile = {
    path: null,
    alarm: null
};

/*
 * The logic to cache a file
 *
 * - if a file has been open for `loadDelay`
 *   OR
 * - if we have reopened the same file twice in succession
 *
 * in either case, a cache is only applied if the queue is below a
 * threshold
 *
 */

function /*Promise*/ onOpen(fileObj) {

    // is this the same file as last time?
    if (lastFile.path && fileObj.path+'' === lastFile.path+'') {
        // clear any timer, as we are caching now
        if (lastFile.alarm) {
            lastFile.alarm.cancel();
            lastFile.alarm = null;
        }
        if (!worker.waiting) {
            lastFile.path = ''; // try to avoid triggering this one again
            return fileObj.ensureLoaded();
        }
    } else {
        // a different (new) file, so we set an alarm to see if we
        // will hold it open for the delay

        lastFile.path = fileObj.path;
        // clear any old timer
        if (lastFile.alarm) {
            lastFile.alarm.cancel();
        }
        lastFile.alarm = util.alarm(options.loadDelay);
        lastFile.alarm
        .then(() => {
            if (!worker.waiting)
                return fileObj.ensureLoaded();
        }, err => null) // swallow alarm cancellation
        .done(); // anything else fatal
        // return nothing
    }
}

function /*Promise*/ onClosed(fileObj) {
    // closing a file - did we set the timer?, if so lets cancel
    if (lastFile.alarm && lastFile.path+'' === fileObj.path+'') {
        lastFile.alarm.cancel();
        lastFile.alarm = null;
    }
    // return nothing
}

exports = module.exports = CacheFile;


