/*
 * File cache
 *
 * Provides a local cache of files. A cache is a colection of "file entries"
 * Each entry can be in one of three states:
 * - cached - in which case we should use the cached file
 * - loading - in the process of being cached. once complete, then any
 *              files waiting on this cache entry will be signalled to
 *              switch to cached
 * - queued - waiting to be cached, but not yet being copied
 *
 * Change of state is signalled by emitting events
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:cache')
  , assert = require('assert')
  , EventEmitter = require('events')
  , Promise = require('pixpromise')
  , fs = require('fs-extra')
  , options = require('./options')
  , log = options.log
  , Path = require('pathlib')
  , Worker = require('./worker')

  , openFile = Promise.promisify(fs.open)
  , closeFile = Promise.promisify(fs.close)
  , readFile = Promise.promisify(fs.read)
  , writeFile = Promise.promisify(fs.write)
  ;

var CATNAP = 60 * 1000; // 60 seconds

/*
 * CacheEntry
 *
 * A single file, which may or may not have been cached yet
 *
 * It emits 'cached' when it has been cached
 */

var QUEUED = 'QUEUED'
  , LOADING = 'LOADING'
  , CACHED = 'CACHED'
  ;

class CacheEntry extends EventEmitter {
    constructor(path) {
        super();
        this.path = Path(path);     // the original file
        this.cachefile = null;      // the cached copy
        this.state = QUEUED;
        this.date = Date.now();     // when created
    }

    isQueued() { return this.state === QUEUED; }
    isCached() { return this.state === CACHED; }
    isLoading() { return this.state === LOADING; }

    /*
    * load
    *
    * The main action taken to pre-load a file into the cache, and signal
    * that it has loaded
    */
    /*Promise*/ load(cachedir) {
        if (this.isCached() || this.isLoading()) {
            return Promise.resolve();
        }

        this.state = LOADING;

        // get a new random name
        return this._getCacheFilename(cachedir)
        .then(name => {this.cachefile = name;})

        // copy the source to the cache dir
        .then(() => copyFile(this.path, this.cachefile))

        // update the details
        .then(size => {
            this.size = size;
            this.state = CACHED;
        })

        // signal to any listeners
        .then(() => this.emit('loaded', this));
    }

    /*Promsie*/ _getCacheFilename(cachedir) {
        cachedir = Path(cachedir);

        function randName() {
            var name, file;
            name = "cache-" +
                Math.random().toString(36).slice(2,10) +
                ".dat";
            file = cachedir.join(name);
            return file.exists()
            .then(exists => exists ? randName() : file);
        }
        return randName();

    }
}

/*
 * the cache of stored files
 *
 * this is a collection of CacheEntry objects.
 *
 * These objects are stored in two places
 * - a map of <path> -> entry
 *      used for looking up existing cache entries (and testing if one
 *      exists
 * - a list of entries not yet loaded (subset of the above)
 *      acts as the queue for the loader
 *
 * the cache listens for events on the CacheEntry. When loaded, it updates
 * the total size, and see it still active in the same directory. If so, then
 * all the entries siblings are cached too.
 *
 */


class Cache {
    constructor(opts) {
        // properties of the cache
        this.dir = Path(opts.dir);
        this.maxsize = opts.maxsize;
        this.maxage = opts.maxage;

        // cache storage
        this.map = new Map();   // path -> entry
        this.queue = [];        // age order - not yet loaded

        this.size = 0;
        this.lastDirectory = null;
        this.worker = new Worker(() => this.doWork());
    }

    start() {
        return this.worker.start();
    }

    /*Promise*/ stop() {
        debug('stopping');
        return this.worker.stop()
        .then(() => this.removeAll())
        .then(() => this._clearManifest());
    }

    find(path, isSibling) {
        /* searches the cache for the entry for this path and returns it
         *
         * if not found, a new entry is added, if it matches the filter
         * for cacheable files. otherwise we return null.
         *
         * isSibling is set if this is a "sibling" precache request - so
         * can ignore it if we have moved to a different directory
         *
         */
        path = Path(path);

        if (isSibling && path.parent().path !== this.lastDirectory.path) {
            return null; // we are ignoring the sibling pre-cache request
        }

        if (!options.filter(path.path)) {
            return null;    // not a cacheable file
        }

        this.lastDirectory = path.parent();

        // add an entry if needed to the cache and queue
        var entry = this.map.get(path.path);

        // already have an entry?
        if (entry) { return entry; }

        debug('requesting cache of %s', path);

        entry = new CacheEntry(path);
        this.map.set(path.path, entry);
        this.queue.push(entry);
        this.worker.wake();

        return entry;
    }

    /*Promise*/ cacheSiblings(entry) {
        return entry.path.parent().readdir()
        .filter(child => child.load().then(data => data.type === 'file'))
        .map(file => this.find(file, true));
    }

    /*Promise*/ remove(entry) {
        debug('removing %s from cache', entry.path);

        assert(!entry.isLoading(), 'cannot remove a loading entry');

        return this._remove(entry)
            .then(() => this._writeManifest());
    }

    /*Promise*/ _remove(entry) {
        // remove from the map, list and queue
        this.map.delete(entry.path.path);
        this.queue = this.queue.filter(e => e !== entry);

        // remove from the cache directory if cached
        if (entry.isCached()) {
            this.size -= entry.size;
            log('%s uncached', entry.path);
            assert(entry.cachefile.path.startsWith(this.dir.path));
            return entry.cachefile.unlink();
        }
        return Promise.resolve();
    }

    /*Promise*/ removeAll() {
        return Promise.all(this.map.values())
            .map(e => this._remove(e))
            .then(() => this._writeManifest());
    }

    /*Promise*/ _writeManifest() {
        var data = Array.from(this.map.values())
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

    first() {
        // returns the first (oldest) entry in the cache
        // undefined if the cache is empty
        return this.map.values().next().value;
    }

    /*Promise*/ doWork() {

        /*
         * Order in which we do work
         * 1. Prune due to size
         * 2. Cache fills
         * 3. Prune due to age
         */

        /* Prune if too big */
        if (this.size > this.maxsize) {
            debug('cache too big. pruning');
            return this.remove(this.first())
                .then(() => null); // repeat
        }

        /* load uncached entry */
        if (this.queue.length) {
            let entry = this.queue.shift();
            return entry.load(this.dir)
            .then(() => {
                debug('%s cached into %s (%d bytes)',
                        entry.path, entry.cachefile, entry.size);
                log('%s cached', entry.path);
                this.size += entry.size;
            })
            .then(() => this._writeManifest())
            .then(() => null); // repeat more work
        }

        /* prune if too old */
        {
            let first = this.first();
            let ageLimit = Date.now() - this.maxage;
            if (first && first.date < ageLimit) {
                debug('cache too old. pruning');
                return this.remove(first)
                    .then(() => null);  // repeat
            }
        }

        // nothing to do?
        return Promise.resolve(CATNAP); // doze for a bit
    }

}



/*
 * A promise of a copied file, returning the size
 */
function copyFile(from, to) {

    var fin, fout, size, buff, buffsize;

    from = from.toString();
    to = to.toString();

    buffsize = 128 * 1024;
    buff = Buffer.alloc(buffsize);
    size = 0;

    function copyChunks() {
        return readFile(fin, buff, 0, buffsize, null)
        .then(count => {
            if (count === 0) // finished
                return;
            size += count;
            return writeFile(fout, buff, 0, count)
            .then(() => copyChunks()); // keep going
        });
    }

    return openFile(from, 'r')
    .then(fh => {fin = fh;})
    .then(() => openFile(to, 'w'))
    .then(fh => {fout = fh;})
    .then(() => copyChunks())
    .then(() => closeFile(fin))
    .then(() => closeFile(fout))
    .then(() => size);
}


module.exports = Cache;

