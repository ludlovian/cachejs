/*
 * Recent file manager
 *
 */


'use strict';

/*
 * Requires & promisifieds
 */


const debug = require('debug')('cachejs:recent')
    , EventEmitter = require('events').EventEmitter
    , PromiseTimer = require('promise-timer')

    , options = require('./options')
    , log = require('./util').log
    , cache = require('./cache')
    , worker = require('./worker')

    ;

/*
 * The logic to manage recent files. A file (which is not yet cached)
 * is added to the cache list if
 *
 * - if a file has been open for `loadDelay` seconds
 *     OR
 * - if we have reopened the same file enough times recently
 *
 * If a recent file is indeed chosen for caching, it will emit a
 * `cached` event once it has been cached, allowing any open files to
 * switch to the cached version
 *
 * the list of recently used files is stored in usage order in a map
 *
 */

class RecentFile extends EventEmitter {
    constructor(path) {
        super();
        this.path = path;
        this.touch = 0;
    }

    static create(path) {
        // creates a new Recent File
        var key = path.toString();
        var map = RecentFile.map;

        var mru = map.get(key);
        if (mru) {
            // delete and re-add to refresh
            map.delete(key);
            map.set(key, mru);
        } else {
            mru = new RecentFile(path);
            map.set(key, mru);
            RecentFile.removeOldest();
        }
        return mru;
    }

    static removeOldest() {
        var map = RecentFile.map;
        if (map.size <= options.recentCount) {
            return false; // not too big
        }
        var key = map.keys().next().value;
        map.delete(key);
        return true;
    }

    static locate(path) {
        var key = path.toString();
        var map = RecentFile.map;
        return map.get(key);
    }

    onOpened() {
        this.touch++;
        debug('touched %d times', this.touch);
        if (this.touch >= options.touchLimit) {
            if (this.openTimer) {
                this.openTimer.cancel();
                this.openTimer = null;
            }
            log(4,'REQ-QTY:  %s', this.path);
            worker.push(`cache file: ${this.path}`, () => this.cacheFile());
            return;
        }

        // set the alarm for time-based caching
        this.openTimer = PromiseTimer.alarm(options.loadDelay);
        this.openTimer.then(() => {
            debug('timer fired for %s', this.path);
            log(4,'REQ-TIME: %s', this.path);
            worker.push(`cache file: ${this.path}`, () => this.cacheFile());
        }, () => {}); // swallow cancelled error

    }

    onClosed() {
        if (this.openTimer) {
            this.openTimer.cancel();
            this.openTimer = null
        }
    }

    async cacheFile() {
        var cached = await cache.cacheFile(this.path);
        if (cached) {
            this.emit('cached', this.path);
        }
        worker.push(`cache siblings: ${this.path}`, () => cache.cacheSiblings(this.path));
    }

}

RecentFile.map = new Map();

module.exports = RecentFile;


