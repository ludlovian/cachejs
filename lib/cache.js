/*
 * File cache
 *
 * The cache object itself is a collection of entries, which deals with
 * creating new entries, background loading, and housekeeping
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:cache')
  , assert = require('assert')
  , Promise = require('pixpromise')
  , fs = require('fs-extra')
  , options = require('./options')
  , log = options.log
  , Path = require('pathlib')
  , Worker = require('./worker')
  , CacheEntry = require('./entry')

  ;

var CATNAP = 60 * 1000; // 60 seconds


/*
 * the cache of stored files
 *
 * this is a collection of CacheEntry objects, stored as a map
 *  path -> entry
 *
 * The main access points are:
 *      find        return an entry (adding if necessary)
 *      remove      remove an entry
 *
 *      start/stop
 *
 * It also does housekeeping internally:
 *
 * - loading queued files
 * - pre-loading siblings if we are still in the same directory
 * - pruning the cache based on size or age
 *
 */


class Cache {
    constructor(opts) {
        // properties of the cache
        this.dir = Path(opts.dir);
        this.maxsize = opts.maxsize;
        this.maxage = opts.maxage;

        // cache storage
        this.entries = new Map(); // path -> entry

        this.mostRecent = null; // most recent entry to have been used
        this.worker = new Worker(() => this.doWork());
    }

    getFirstQueued() {
        // the first queued ordered by most recently used
        return Array.from(this.entries.values())
            .filter(e => e.isQueued())
            .sort((a,b) => a.mru > b.mru ? -1
                            : a.mru < b.mru ? 1
                            : 0)
            [0];
    }

    getCacheSize() {
        var size = 0;
        for (var entry of this.entries.values()) {
            if (entry.isCached()) {
                size += entry.size;
            }
        }
        return size;
    }

    getOldestCached() {
        return Array.from(this.entries.values())
            .filter(e => e.isCached())
            .sort((a,b) => a.mru < b.mru ? -1 :
                           a.mru > b.mru ? 1  :
                           0)
            [0];
    }

    start() {
        return this.worker.start();
    }

    /*Promise*/ stop() {
        debug('stopping');
        return Promise.race([
            this.worker.stop(),
            Promise.delay(10*1000)
                .then(() => log('Worker failed to stop'))
        ])
        .then(() => this.removeAll())
        .then(() => this._clearManifest());
    }

    find(path) {
        /* searches the cache for the entry for this path and returns it
         *
         * if not found, a new entry is added, if it matches the filter
         * for cacheable files. otherwise we return null.
         */
        path = Path(path);

        if (!options.filter(path.path)) {
            return null;    // not a cacheable file
        }

        var entry;

        // already cached?
        entry = this.entries.get(path.path);
        if (entry) {
            return entry;
        }

        // create a new entry in the queue
        debug('queueing cache of %s', path);

        entry = new CacheEntry(this, path);
        this.entries.set(path.path, entry);
        this.worker.wake();

        return entry;
    }

    /*Promise*/ doWork() {
        var work;

        work = this.loadFile();
        if (work) return work.then(() => null); // repeat

        work = this.pruneSize();
        if (work) return work.then(() => null); // repeat

        work = this.pruneAge();
        if (work) return work.then(() => null); // repeat

        return Promise.resolve(CATNAP);  // doze
    }

    /*
     * loadFile
     *
     * Find a queued cache entry and load it
     *
     * Once loaded, then queue any siblings if we are still in the same
     * directory
     *
     * Return a promise if there is work, or null otherwise
     */

    onSameDirectoryAs(entry) {
        // on same directory if the parent paths are the same
        return this.mostRecent && entry &&
                (this.mostRecent.path.parent().path ===
                    entry.path.parent().path);
    }

    /*Promise*/ loadFile() {

        var entry = this.getFirstQueued();
        if (!entry)
            return null;

        // load the file, and add to cached
        debug('decided to load %o', entry);
        return entry.load()
        .then(() => this._writeManifest())
        .then(() => this.onSameDirectoryAs(entry) ?
                        this.cacheSiblings(entry) : null);
    }

    /*Promise*/ pruneSize() {
        // remove one from cache if too big
        if (this.getCacheSize() <= this.maxsize)
            return null;

        var entry = this.getOldestCached();
        debug('cache too big. pruning');
        return this.remove(entry);
    }

    /*Promise*/ pruneAge() {
        // remove the LRU if too old
        var entry = this.getOldestCached();
        if (!entry)
            return null;
        if (entry.mru < Date.now() - this.maxage) {
            debug('cache too old. pruning');
            return this.remove(entry);
        } else {
            return null;
        }
    }

    /*Promise*/ cacheSiblings(entry) {
        /*
         * Create cache entries for all the siblings.
         */
        debug('Loading siblings for %o', entry);
        return entry.path.parent().readdir()
        .filter(child => child.load().then(data => data.type === 'file'))
        .map(file => this.find(file));
    }

    /*Promise*/ remove(entry) {
        debug('removing %s from cache', entry.path);

        assert(!entry.isLoading(), 'cannot remove a loading entry');

        return this._remove(entry)
            .then(() => this._writeManifest());
    }

    /*Promise*/ _remove(entry) {
        this.entries.delete(entry.path.path);
        return entry.remove();
    }

    /*Promise*/ removeAll() {
        return Promise.all(Array.from(this.entries.values()))
        .map(e => this._remove(e))
        .then(() => this._writeManifest());
    }

    /*Promise*/ _writeManifest() {
        var data = Array.from(this.entries.values())
            .filter(entry => entry.isCached())
            .map(entry => entry.path + ' ' + entry.cachefile +
                    ' ' + entry.size + '\n')
            .join('');
        var manifest = this.dir.join('manifest');
        return manifest.write(data);
    }

    /*Promise*/ _clearManifest() {
        var manifest = this.dir.join('manifest');
        return manifest.exists()
        .then(exists => exists ? manifest.unlink() : null);
    }


}

module.exports = Cache;

