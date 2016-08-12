/*
 * Cache entries also track the files currently using them (i.e. open files)
 * which allows them to signal when the cache has been loaded, and the most
 * recent use time
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:entry')
  , assert = require('assert')
  , Promise = require('pixpromise')
  , fs = require('fs-extra')
  , options = require('./options')
  , log = options.log
  , Path = require('pathlib')

  , openFile = Promise.promisify(fs.open)
  , closeFile = Promise.promisify(fs.close)
  , readFile = Promise.promisify(fs.read)
  , writeFile = Promise.promisify(fs.write)
  ;

/*
 * CacheEntry
 *
 * A single file, which may or may not have been cached yet
 * It can be:
 * - QUEUED = uncached
 * - LOADING = will soon be loaded
 * - CACHED = a cache file exists
 *
 *
 * Access points
 *   attach     attach a file object to this entry
 *   release    release the file object
 *   load       load the file into cache
 *   remove     remove any cached file
 *
 */

var QUEUED = 'QUEUED'
  , LOADING = 'LOADING'
  , CACHED = 'CACHED'
  ;

class CacheEntry {
    constructor(cache, path) {
        this.cache = cache;         // the cache we are part of
        this.path = Path(path);     // the original file
        this.cachefile = null;      // the cached copy
        this.state = QUEUED;
        this.mru = Date.now();      // most recent usage
        this.files = new Set();     // files using this entry
    }

    // introspection
    isQueued() { return this.state === QUEUED; }
    isCached() { return this.state === CACHED; }
    isLoading() { return this.state === LOADING; }
    getFilename() { return this.isCached()
                                ? this.cachefile
                                : this.path; }

    inspect() { return 'CacheEntry('+this.path+')'; }


    /*
     * Attach / release file object
     */
    attach(file) {
        debug('attaching %o to %o', file, this);
        this.files.add(file);
        this.mru = Date.now();
        // tell the cache that I am the most recent entry
        this.cache.mostRecent = this;
    }

    /*Promise*/ release(file) {
        debug('releasing %o from %o', file, this);
        this.files.delete(file);

        // if no-one else is using, and still not cached, then
        // remove from cache

        if (this.files.size === 0 &&
            this.isQueued()) {
            debug('never cached. deleting');
            return this.cache.remove(this);
        } else {
            return Promise.resolve();
        }
    }


    /*
    * load
    *
    * The main action taken to pre-load a file into the cache, and signal
    * that it has loaded
    */
    /*Promise*/ load(cachedir) {
        if (!this.isQueued()) {
            return Promise.reject(new Error(
                    "Trying to load an entry twice"));
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
            debug('%s cached into %s (%d bytes)',
                    this.path, this.cachefile, this.size);
            log('%s cached', this.path);
        })

        // signal to any listeners
        .then(() => {
            return Promise.resolve(Array.from(this.files))
            .map(file => file.switchToCached());
        });
    }

    /*Promise*/ _getCacheFilename() {
        var cachedir = Path(this.cache.dir);

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

    /*Promise*/ remove() {
        if (this.isCached()) {
            assert(this.cachefile.path.startsWith(options.cachedir.path));
            return this.cachefile.unlink()
            .then(() => {
                log('%s uncached', this.path);
            });
        }
        return Promise.resolve();
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

module.exports = exports = CacheEntry;
