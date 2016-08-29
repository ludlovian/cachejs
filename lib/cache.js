/*
 * File cache
 *
 * controls the cache loading and housekeeping of the cached files
 *
 * we assume that if a file is cached, it is correct. A regular
 *  rsync --existing --delete
 * will also ensure that
 *
 * the public entry points are:
 *
 *  start/stop      - to start & stop the stuff
 *  load            - load/reload
 *  find            - promise of a cache entry
 *  loadFile        - load a file into cache
 *  siblingCheck    - preload some siblings
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

require('pixpromise'); // fixup promise

var debug = require('debug')('cachejs:cache')
  , options = require('./options')
  , db = require('./db')
  , util = require('./util')
  , log = util.log
  , worker = require('./worker')

  ;



/* start & stop */
function /*Promise*/ start() {
    debug('starting');

    // start the database
    return db.start()
    .then(() => {
        worker.push(()=>load());
    })
    .then(() => debug('started'));
}

function /*Promise*/ stop() {
    debug('stopping');
    return worker.stop()
    .then(() => db.stop())
    .then(() => debug('stopped'));
}

/*
 * Find
 *
 * find(path,opts)
 *
 * Promise of the cache record, updating the MRU if asked
 *
 */
function /*Promise*/ find(path, opts) {
    opts = opts || {};
    debug('find %s %o', path, opts);

    if (opts.mru) {
        return db.update(
            {_id: path+''},
            {$set: {mru: new Date()}},
            {returnUpdatedDocs: true}
        )
        .then(result => {
            var rec = null;
            if(result.num)
                rec = result.docs;
            debug('found = %o', rec);
            return rec;
        });
    } else {
        return db.findOne(
            {_id: path+''}
        ).tap(rec => debug('found = %o', rec));
    }
}

/* loadFile
 *
 * Loads a file into the cache (maybe)
 *
 * returns true if loaded (which is always in this version)
 */

function /*Promise*/ loadFile(path) {
    debug('loadFile %s', path);

    // get the cache record for this file
    return db.findOne({_id: path+''})
    .then(rec => {
        if (!rec)
            return false; // no record of file

        if (rec.cached)
            return false; // already loaded

        // copy the file over
        return copyFileToCache(path)

        // update the database to say it is cached
        .then(file =>
            db.update(
                {_id: path+''},
                {$set: {cached: true, mru: new Date()}}
            ))
        .tap(() => log(2, "CACHED:   %s", path))

        // prune the cache if now too big
        .then(() => pruneFiles())

        .then(() => true); // return true as we did load it
    })
    .done(); // all errors fatal
}

function /*Promise*/ copyFileToCache(path) {
    /* Copies a file from source to cache, returning
     * the loaded path of the cached file
     */
    var src = util.realFile(path, false);
    var dst = util.realFile(path, true);

    // make the parent dirs first
    return dst.parent().mkdirs()
    // then copy
    .then(() => {
        debug('copying from %s to %s', src, dst);
        return dst.copyFrom(src);
    })
    // then load the dest and return it
    .then(() => dst.load())
    .then(() => dst);
}


/*
 * siblingCheck
 *
 * checks that the next `n` siblings are preloaded
 *
 */

function /*Promise*/ siblingCheck(path) {

    debug('performing sibling check for %s', path);
    log(4,'SIBS:     %s', path);
    return getNextFewSiblings(path, options.siblings)
    .mapSeries(sibling => {
        debug('request load of sibling %s', sibling);
        worker.push(() => loadFile(sibling));
    })
    .done();
}

function getNextFewSiblings(path, qty) {
    var parent = path.parent();
    var me = path.name();
    // scan the source directory
    return util.realFile(parent, false).readdir()
    .then(children => {
        var names =
        // turn real files into virtual paths
        children.map(f => util.filePath(f, false))
        // filter only those we should cache
        .filter(options.filter)
        // extract the raw names
        .map(p => p.name())
        // and sort lexically
        .sort();

        // and return the next few after
        var sibs = names.slice(names.indexOf(me)).slice(1, qty+1)
        // converted back into paths
        .map(n => parent.join(n));

        debug('next few siblings=%o', sibs);
        return sibs;
    });
}

/*
 * Startup housekeeping
 *
 * - reconcile the database with the physical files (source & cache)
 * - remove old files to prune the cache
 * - compact the database
 */

function /*Promise*/ load() {
    debug('loading');

    options.load();
    log(2,'Reloading files');

    return syncDatabase()
    .then(() => pruneFiles())
    .then(() => db.compact())
    .tap(() => debug('loaded'))
    .then(() => getCacheSize())
    .then(size => {
        log(1,'Reloaded.\nConfiguration:');
        log(1,'    cache dir:       %s', options.cache);
        log(1,'    cache max (MB):  %s',
                util.comma(Math.floor(options.cachesize/(1024*1024))));
        log(1,'    cache size (MB): %s',
                util.comma(Math.floor(size/(1024*1024))));
        log(1,'    load delay (ms): %d', options.loadDelay);
        log(1,'    sibling preload: %d', options.siblings);
        log(1,'    filter:          %s', options.filterSource);
        log(1,'    log level:       %d', options.logLevel);
    })
    .done();
}

/*
 * Syncs the database with the source files, tagging those in the
 * cachedir as cached. It DOESNT check that cache==source
 *
 * Any extraneous files in the cachedir are removed
 *
 * Any extraneous records in the database are removed
 *
 * Any new records are given a fresh mru
 *
 */

function /*Promise*/ syncDatabase() {
    debug('syncing database');

    // we gather all the files in the cache & source dirs
    return Promise.all([
        scanFiles(false),   // source dir
        scanFiles(true),    // cache dir
        scanDB()            // db records
    ])
    .spread((srcMap, cacheMap, dbMap) => Promise.all([
        updateSourceFiles(srcMap, cacheMap, dbMap),
        removeCacheFiles(srcMap, cacheMap),
        removeCacheEntries(srcMap, dbMap)
    ]))
    .then(() => db.update(
        {mru: {$exists: false}},
        {$set: {mru: new Date()}},
        {multi: true}
    ));
}

/*
 * returns a map of path -> pathObject
 *
 * filters pathobjects to files matching the options
 * adjusts paths back to virtual paths (but keeping metadata)
 */
function /*Promise*/ scanFiles(cached) {
    var scan = util.realFile('',cached).scan({collect: true});
    return scan.then(() => new Map(
        // turn paths back to virtual paths
        scan.files.map(f => {
            var p = util.filePath(f, cached);
            p.meta = f.meta;
            return p;
        })
        // filter only files
        .filter(p => p.meta.type === 'file')
        // filter out cache.db
        .filter(p => p.path != '/cache.db')
        // filter based on options
        .filter(options.filter)
        // now convert to key, value pairs
        .map(p => [p.path, p])
    ));
}

/*
 * returns a map of the database
 */

function /*Promise*/ scanDB() {
    return db.find({})
    .then(recs => new Map(
        recs.map(rec => [rec._id, rec])
    ));
}

/*
 * updates the database from the source files, setting
 * cached depending on whether they are cached
 */
function /*Promise*/ updateSourceFiles(srcMap,cacheMap, dbMap) {
    // first we workout which of the src files need updating
    var updates = Array.from(srcMap.values())
    .filter(p => {
        if (!dbMap.has(p.path))
            return true;
        var rec = dbMap.get(p.path);
        if (rec.cached != cacheMap.has(p.path) ||
            rec.size != p.meta.size)
            return true;
        return false;
    });
    debug('updated files = %o', updates);
    return Promise.map(updates, p =>
        db.update(
            {_id: p.path},
            {$set: {size: p.meta.size,
                    cached: cacheMap.has(p.path)}},
            {upsert: true}
        )
    );
}

/*
 * removes old files, parent dirs for any files
 * in the cache no longer in the source
 */
function /*Promise*/ removeCacheFiles(srcMap, cacheMap) {
    var oldFiles = Array.from(cacheMap.values())
        .filter(p => !srcMap.has(p.path));
    debug('old files = %o', oldFiles);
    return Promise.map(oldFiles, p =>
        db.remove({_id: p.path})
        .then(() => removeCacheFile(p))
    );
}

/*
 * removes a file and its parent dirs
 */
function /*Promise*/ removeCacheFile(path) {
    var f = util.realFile(path, true);
    return f.unlink()
    .then(() => f.parent().rmdirs(util.realFile('', true)));
}

/*
 * removes old database entries no longer in the source
 */
function /*Promise*/ removeCacheEntries(srcMap, dbMap) {
    var oldEntries = Array.from(dbMap.keys())
        .filter(s => !srcMap.has(s));
    debug('old entries = %o', oldEntries);
    return Promise.map(oldEntries, s =>
        db.remove({_id: s})
    );
}

function /*Promise*/ pruneFiles() {
    debug('prune files');
    return getCacheSize()
    .then(size => _pruneFiles(size))
    .tap(() => debug('files pruned'))
    .done();
}

function /*Promise*/ _pruneFiles(size) {
    if (size <= options.cachesize)
        return Promise.resolve(); // already small enough

    // now we remove the oldest file
    debug('size is too big at %d. need to remove one', size);

    return db.findOne(
            {cached: true},
            {sort: {mru: 1}}
    )
    .then(rec => {
        if (!rec) return;
        debug('least recently used = %o', rec);
        return db.update(
            {_id: rec._id},
            {$set: {cached: false}}
        )
        .then(() => removeCacheFile(rec._id))
        .tap(() => log(2,"UNCACHED: %s", rec._id))
        .then(() => _pruneFiles(size - rec.size));
    })
    .done();
}

function /*Promise*/ getCacheSize() {
    return db.find({cached: true})
    .then(recs => recs.reduce((sum, rec) => sum + rec.size, 0))
    .tap(size => debug('Total size=%d', size));
}

module.exports = {
    start:          start,
    stop:           stop,
    find:           find,
    loadFile:       loadFile,
    siblingCheck:   siblingCheck,
    load:           load
};


