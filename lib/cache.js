/*
 * File cache
 *
 * controls the cache loading and housekeeping of the cached files
 *
 * we assume that if a file is cached, it is correct. A regular
 *  rsync --existing --delete
 * will also ensure that
 *
 * the main entry points are:
 *
 *  start/stop  - to start & stop the worker
 *  register/unregister - to (un)register a file's interest in a path
 *
 * If a file is not cached, we add a `loadFile` call to the work queue. If
 * that is completed successfully (and we only load files if there is someone
 * still using it) then we queue up the siblings if we are still in the
 * same directory
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

  ;

// the root of the underlying filesystem
var root = Path(options.source);
var cacheroot = Path(options.cachedir);



/*
 * the cache of stored files
 *
 * this is a collection of CacheEntry objects, stored as a map
 *  path -> entry
 *
 */


class CacheEntry {
    constructor(path) {
        this.path = path;
        this.usage = 0; // how many files using this
        this.listeners = new Set(); // files waiting for a load
        this.mru = Date.now();
    }
}

var cacheEntries = new Map();      // path -> entry
var currentPath = Path();   // the path of the most recently used file

var worker = new Worker();
worker.onIdle(options.housekeep, housekeep);
worker.push(housekeep);

function getEntry(path) {
    path = Path(path);
    var entry = cacheEntries.get(path.path);
    if (!entry) {
        entry = new CacheEntry(path);
        cacheEntries.set(path.path, entry);
    }
    return entry;
}

function register(path, file, cached) {
    debug('attaching %o to entry for %s', file, path);
    var entry = getEntry(path);
    entry.usage++;
    entry.mru = Date.now();
    currentPath = Path(path);
    // if not on the cached one, then add it to the queue, and listeners
    if (!cached) {
        entry.listeners.add(file);
        worker.push(() => loadFile(path));
    }
}

function unregister(path, file) {
    debug('detaching %o from entry for %s', file, path);
    var entry = getEntry(path);
    entry.usage--;
    entry.mru = Date.now();
    entry.listeners.delete(file);
}

/* Loading logic
 *
 * We do not proceed if there is no usage - no-one is interested
 * unless we are pre-loading (e.g. siblings)
 *
 * After loading, we signal any listeners
 *
 * If load Siblings is flagged, then we also tag on a loadSiblings task once
 * completed
 */

function /*Promise*/ loadFile(path, opts) {
    opts = opts || {};

    debug('thinking about loading %s', path);

    var entry = getEntry(path);
/*
    if (opts.preload && !_onSameDirectoryAs(path)) {
        debug('abandon preload - changed dir');
        return Promise.resolve();
    }
*/
    if (!opts.preload && entry.usage === 0) {
        debug('abandon load - no interest');
        return Promise.resolve();
    }

    var src = root.join(path);
    var dst = cacheroot.join(path);

    return dst.exists()
    .then(exists => {
        if (exists) {
            debug('%s already exists', dst);
            return;
        }
        return _copy(src, dst)
        .then(() => log('%s cached', path))
        .then(() => _signalListeners(path, dst))
        .then(() => {
            if (!opts.preload) {
                worker.push(() => loadSiblings(path));
            }
        });
    });
}


function _onSameDirectoryAs(path) {
    return currentPath.parent().path === path.parent().path;
}

function /*Promise*/ _copy(src, dst) {
    // make the parent dirs
    return dst.parent().mkdirs()
    // copy the file if not already existing
    .then(() => {
        debug('copying from %s to %s', src, dst);
        return dst.copyFrom(src);
    });
}

function /*Promise*/ _signalListeners(path, newFile) {
    var entry = getEntry(path);
    debug('signalling %d listeners', entry.listeners.size);
    return Promise.all(entry.listeners)
        .map(file => file.switchToFile(newFile));
}

function /*Promise*/ loadSiblings(path) {
    // don't bother if we have already switched directory
    if (!_onSameDirectoryAs(path))
        return Promise.resolve();

    debug('queueing siblings of %s', path);
    var dir = root.join(path).parent();
    var rootlen = (root+'').length;
    // read the dir
    return dir.readdir()
    // filter only files
    .filter(f => f.load().then(d => d.type === 'file'))
    // filter those matching options
    .filter(f => options.filter(f.path))
    // strip out the root to make a path
    .map(f => Path(f.path.slice(rootlen)))
    // and add to the work queue
    .map(sib => {
        debug('queueing preload of %s', sib);
        worker.push(() => loadFile(sib, {preload: true}));
    });
}

function start() {
    return;
}

function /*Promise*/ stop() {
    debug('stopping');
    return worker.stop()
        .then(() => debug('stopped'));
}


function /*Promise*/ housekeep() {
    // TODO - cache size & prune
    debug('housekeeping');

    return scanCache()
    .then(() => pruneSize());
}

/*
 * scanCache
 *
 * scans the actual files in the cache, and ensure the cacheEntries are
 * in sync with them
 *
 */
function /*Promise*/ scanCache() {
    var oldFiles = new Set(cacheEntries.keys());
    var prefix = cacheroot.path.length;
    return cacheroot.scan()
    .on('file', f => {
        if (f.meta.type !== 'file')
            return;
        f.path = f.path.slice(prefix);
        var entry = getEntry(f.path);
        entry.size = f.meta.size;
        oldFiles.delete(f.path);
    })
    .then(() => {
        for(var p of oldFiles) {
            debug('removing entry for missing cache file: %s', p);
            cacheEntries.delete(p);
        }
        debug('%d files in cache scanned', cacheEntries.size);
    });
}

function /*Promise*/ pruneSize() {
    if (getTotalSize() > options.cachesize) {
        var entry = getOldestFile();
        debug('too big.removing %o', entry);
        cacheEntries.delete(entry.path + '');
        return cacheroot.join(entry.path).unlink()
        .then(() => {
            log('%s uncached', entry.path);
        })
        .then(() => pruneSize());
    }
}

function getTotalSize() {
    var s = Array.from(cacheEntries.values())
    .reduce((tot, entry) => tot += (entry.size || 0), 0);
    debug('Total size=%d', s);
    return s;
}

function getOldestFile() {
    return Array.from(cacheEntries.values())
    .sort((a,b) => a.mru < b.mru ? -1 :
                   a.mru > b.mru ?  1 :
                   0)
    [0];
}

exports.register = register;
exports.unregister = unregister;
exports.start = start;
exports.stop = stop;



