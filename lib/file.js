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
        onClose(this);
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

/*
 * The logic to cache a file
 *
 * - if a file has been open for `loadDelay`
 *   OR
 * - if we have reopened the same file twice recently
 *
 * in either case, a cache is only applied if the queue is below a
 * threshold
 *
 * we track each file with a UsageTracker object (keyed on path, not object)
 * and we keep the last few of these in mru order
 *
 */


var recentFiles = new Map();

function /*Promise*/ onOpen(fileObj) {
    var key = fileObj.path + '';
    debug('onOpen',key);
    var usage = recentFiles.get(key);
    if (usage) {
        // delete and re-add so it is last
        recentFiles.delete(key);
        recentFiles.set(key, usage);
    } else {
        // new one
        usage = new UsageTracker(key);
        recentFiles.set(key, usage);
        if (recentFiles.size > options.recentCount) {
            // remove the first one
            let firstKey, firstUsage;
            [firstKey, firstUsage] = recentFiles.entries().next().value;
            firstUsage.clearAlarm();
            recentFiles.delete(firstKey);
        }
        debug('recentFiles now = %o', recentFiles);
    }
    return usage.onOpen(fileObj);
}

function onClose(fileObj) {
    var key = fileObj.path + '';
    var usage = recentFiles.get(key);
    if (usage) {
        usage.onClose();
    }
}

class UsageTracker {
    constructor(path) {
        this.path = path;
        this.alarm = null;
        this.touch = 0;
    }

    /*Promise*/ onOpen(fileObj) {
        // being called because we are being opened
        // so we have to do two things
        //  - set a timer to check if we are still open in a bit
        //  - check our touch count - if >1 then we should queue the load
        this.touch++;
        debug('touched %d times', this.touch);
        if (this.touch >= options.touchLimit) {
            if (worker.waiting <= options.queueLimit) {
                this.clearAlarm();
                log(4,'REQ-QTY:  %s', this.path);
                return fileObj.ensureLoaded();
            }
            return Promise.resolve();
        }
        // set the alarm
        this.clearAlarm();
        this.alarm = util.alarm(options.loadDelay);
        this.alarm.then(() => {
            this.alarm = null;
            debug('alarm fired for %s', this.path);
            if (worker.waiting <= options.queueLimit) {
                log(4,'REQ-TIME: %s', this.path);
                return fileObj.ensureLoaded();
            }
        }, err => null) // swallow alarm cancellation
        .done(); // anything else fatal
    }

    onClose() {
        this.clearAlarm();
    }

    clearAlarm() {
        if (this.alarm) {
            this.alarm.cancel();
            this.alarm = null;
        }
    }
}


exports = module.exports = CacheFile;


