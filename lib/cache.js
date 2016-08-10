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
 * It can be:
 * - QUEUED = uncached
 * - LOADING = will soon be loaded
 * - CACHED = a cache file exists
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
        this.cached = new Map(); // path -> entry of cached files
        this.queued = new Map(); // path -> entry of queued files

        this.size = 0; // total size of cached files
        this.mostRecent = null; // most recent entry to have been used
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

    find(path) {
        // returns the cache entry for the path
        var entry = this._find(path);
        if (entry)
            this.mostRecent = entry;
        return entry;
    }

    _find(path) {
        /* searches the cache for the entry for this path and returns it
         *
         * If already cached, then it is added to the end of the map (like
         * an MRU cache)
         *
         * if not found, a new entry is added, if it matches the filter
         * for cacheable files. otherwise we return null.
         *
         */
        path = Path(path);

        if (!options.filter(path.path)) {
            return null;    // not a cacheable file
        }

        var entry;

        // already cached?
        entry = this.cached.get(path.path);
        if (entry) {
            // delete & re-add so the entry is at the end
            this.cached.delete(path.path);
            this.cached.set(path.path, entry);
            entry.date = Date.now();
            return entry;
        }

        // already queued?
        entry = this.queued.get(path.path);
        if (entry) {
            return entry;
        }

        // create a new entry in the queue
        debug('queueing cache of %s', path);

        entry = new CacheEntry(path);
        this.queued.set(path.path, entry);
        this.worker.wake();

        return entry;
    }

    /*Promise*/ cacheSiblings(entry) {
        /*
         * Create cache entries for all the siblings. Use the "inner"
         * _find method to avoid setting "most recent"
         */
        return entry.path.parent().readdir()
        .filter(child => child.load().then(data => data.type === 'file'))
        .map(file => this._find(file));
    }

    /*Promise*/ remove(entry) {
        debug('removing %s from cache', entry.path);

        assert(!entry.isLoading(), 'cannot remove a loading entry');

        return this._remove(entry)
            .then(() => this._writeManifest());
    }

    /*Promise*/ _remove(entry) {
        var e;

        // is this entry already cached?
        e = this.cached.get(entry.path.path);
        if (e && e === entry) {
            this.cached.delete(entry.path.path);
            this.size -= entry.size;
            log('%s uncached', entry.path);
            entry.state = QUEUED; // in case anyone has a link to it
            assert(entry.cachefile.path.startsWith(this.dir.path));
            return entry.cachefile.unlink();
        }

        // is this entry queued (but not yet loading)
        // already queued
        e = this.queued.get(entry.path.path);
        if (e && e === entry && entry.isQueued()) {
            this.queued.delete(entry.path.path);
        }

        return Promise.resolve();
    }

    /*Promise*/ removeAll() {
        var all = Array.from(this.cached.values())
            .concat(Array.from(this.queued.values()));

        return Promise.all(all)
            .map(e => this._remove(e))
            .then(() => this._writeManifest());
    }

    /*Promise*/ _writeManifest() {
        var data = Array.from(this.cached.values())
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


    /*Promise*/ doWork() {
        var work;

        work = this.pruneSize();
        if (work) return work.then(() => null); // repeat

        work = this.loadFile();
        if (work) return work.then(() => null); // repeat

        work = this.pruneDir();
        if (work) return work.then(() => null); // repeat

        work = this.pruneAge();
        if (work) return work.then(() => null); // repeat

        return Promise.resolve(CATNAP);
    }

    /*Promise*/ pruneSize() {
        // remove one from cache if too big
        if (this.size <= this.maxsize)
            return null;

        var first = this.cached.values().next().value;
        debug('cache too big. pruning');
        return this.remove(first);
    }

    /*Promise*/ pruneAge() {
        // remove the LRU if too old
        var first = this.cached.values().next().value;
        var ageLimit = Date.now() - this.maxage;

        if (!first || first.date >= ageLimit)
            return null;

        debug('cache too old. pruning');
        return this.remove(first);
    }

    /*Promise*/ pruneDir() {
        // remove the first one which is in the "wrong" directory

        if (!this.mostRecent)
            return null;

        var currDir = this.mostRecent.path.parent().path;

        for(var entry of this.cached.values()) {
            if (entry.path.parent().path !== currDir) {
                debug('cache in wrong directory, removing');
                return this.remove(entry);
            }
        }
        return null;
    }

    /*Promise*/ loadFile() {
        // queue empty?
        if (!this.queued.size)
            return null;

        var entry = this.queued.values().next().value;
        assert(entry.isQueued()); // must be queued to be in queue

        this.queued.delete(entry.path.path);

        // ignore this item if we have already changed directory
        if (this.mostRecent &&
            this.mostRecent.path.parent().path !==
                entry.path.parent().path) {
            debug('ignoring %s', entry.path);
            return Promise.resolve(); // do nothing
        }

        // load the file, and add to cached
        return entry.load(this.dir)
        .then(() => {
            entry.date = Date.now();
            this.cached.set(entry.path.path, entry);
            debug('%s cached into %s (%d bytes)',
                    entry.path, entry.cachefile, entry.size);
            log('%s cached', entry.path);
            this.size += entry.size;
        })
        .then(() => this._writeManifest());
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

