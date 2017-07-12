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


const debug = require('debug')('cachejs:file')
    , EventEmitter = require('events').EventEmitter
    , fs = require('fs-extra')
    , thenify = require('thenify')

    , openFile = thenify(fs.open)
    , readFile = thenify(fs.read)
    , closeFile = thenify(fs.close)

    , Path = require('pathlib')
    , options = require('./options')
    , util = require('./util')
    , log = util.log
    , cache = require('./cache')
    , worker = require('./worker')

    ;

/*
 * PassthruFile
 *
 * Simple passthru mechanism
 *
 */

class PassthruFile{
    constructor(path) {
        this.path = new Path(path);
        this.fd = null;
        debug('creating passthru for %s', this.path);
    }

    inspect() {
        return 'PassthruFile(' + this.path + ')';
    }

    async open() {
        debug('opening %s', this.path);
        var f = util.realFile(this.path) + '';
        this.fd = await openFile(f, 'r');
    }

    async read(buffer, length, position) {
        return await readFile(this.fd, buffer, 0, length, position);
    }

    async close() {
        await closeFile(this.fd);
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
        this.path = new Path(path);
        this.fd = null;
        this.closed = false;
    }

    inspect() {
        return 'CacheFile(' + this.path + ')';
    }

    async open() {
        // try opening the cache version first

        var e = await cache.find(this.path, {mru:true});
        log(3, '%s     %s',
                    (e.cached ? 'HIT: ' : 'MISS:'), this.path);

        var f = util.realFile(this.path, e.cached);
        debug('opening %s', f);
        this.fd = await openFile(f + '','r');

        var mru = RecentFile.create(this.path);
        mru.onOpened();
        if (!e.cached) {
            mru.once('cached', () => this.switchToCached());
        }
    }

    async read(buffer, length, position) {
        debug('reading from %o, %d bytes from %d', this, length, position);
        return await readFile(this.fd, buffer, 0, length, position);
    }

    async close() {
        this.closed = true;
        var mru = RecentFile.locate(this.path);
        if (mru) {
            mru.onClosed();
        }
        await closeFile(this.fd);
    }

    async switchToCached() {
        /* called to switch FDs to the cache version.
         * have to do this carefully in case the file gets closed
         * as we are doing it
         */
        if (this.closed) { return; }

        debug('switching to cached for %s', this.path);

        var cacheFile = util.realFile(this.path, true);

        // open the new file
        var cacheFD = await openFile(cacheFile + '', 'r');

        // bomb out if already closed
        if (this.closed)
        {
            await closeFile(cacheFD);
            return;
        }

        // switch fds, and close the old one
        var oldfd = this.fd;
        this.fd = cacheFD;
        await closeFile(oldfd);
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
            map.delete(key);
            map.set(key, mru);
        } else {
            mru = new RecentFile(path);
            map.set(key, mru);
            // too many?
            if (map.size > options.recentCount) {
                let key1, mru1;
                [key1, mru1] = map.entries().next().value;
                mru1.clearTimer();
                map.delete(key1);
            }
            debug('RecentFiles now = %o', map);
        }
        return mru;
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
            this.clearTimer();
            log(4,'REQ-QTY:  %s', this.path);
            worker.push(() => this.cacheFile());
            return;
        }

        // set the alarm for time-based caching
        this.tm = setTimeout(() => {
            this.tm = null;
            debug('timer fired for %s', this.path);
            log(4,'REQ-TIME: %s', this.path);
            worker.push(() => this.cacheFile());
        }, options.loadDelay);
    }

    onClosed() {
        this.clearTimer();
    }

    clearTimer() {
        if (this.tm) {
            clearTimeout(this.tm);
            this.tm = null;
        }
    }

    async cacheFile() {
        var entry = await cache.find(this.path);
        if (entry && entry.cached) { return; }

        var cached = await cache.cacheFile(this.path);
        if (cached) {
            this.emit('cached', this.path);
        }
        worker.push(() => cache.cacheSiblings(this.path));
    }

}

RecentFile.map = new Map();


exports = module.exports = CacheFile;


