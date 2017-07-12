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
 *  cacheFile       - load a file into cache
 *  cacheSiblings   - preload some siblings
 *
 */

'use strict';

/*
 * Requires & promisifieds
 */

const debug = require('debug')('cachejs:cache')
    , Path = require('pathlib')
    , PathScan = require('pathscan')
    , options = require('./options')
    , db = require('./db')
    , util = require('./util')
    , log = util.log
    , worker = require('./worker')
    ;



/* start & stop */
async function start() {
    debug('starting');

    // start the database
    await db.start();

    // start the worker with a load / refresh
    worker.push(() => load()
        .catch(err => {
            console.error("ERROR:\n%o",err);
            process.nextTick(() => {throw err;});
        })
    );

    debug('started');
}

async function stop() {
    debug('stopping');

    await worker.stop();
    await db.stop();

    debug('stopped');
}



/*
 * Find
 *
 * find(path,opts)
 *
 * Find the cache record, updating the MRU if asked
 *
 */
async function find(path, opts) {
    opts = opts || {};
    debug('find %s %o', path, opts);

    if (opts.mru) {
        let result = await db.update(
            {_id: path + ''},
            {$set: {mru: new Date()}},
            {returnUpdatedDocs: true});

        if (result[0]) { // numDocsFound
            debug('found = %o', result[1]);
            return result[1];
        }

        debug('none found');
        return null; // no record found
    } else {
        let result = await db.findOne({_id: path + ''});
        debug('found = %o', result);
        return result;
    }
}


/* cacheFile
 *
 * Loads a file into the cache (maybe)
 *
 * returns true if loaded (which is always in this version)
 */

async function cacheFile(path) {
    debug('cacheFile %s', path);

    var rec = await db.findOne({_id: path + ''});

    if (!rec) {
        return false; // no record of file;
    }

    if (rec.cached) {
        return false; // already loaded
    }

    var src = util.realFile(path, false);
    var dst = util.realFile(path, true);
    await util.copyFile(src, dst);

    // update the db to mark as cached
    await db.update(
            {_id: path + ''},
            {$set: {cached: true, mru: new Date()}});

    log(2, "CACHED:   %s", path);

    await pruneFiles();

    return true; // was cached
}


/*
 * siblingCheck
 *
 * checks that the next `n` siblings are preloaded
 *
 */

async function cacheSiblings(path) {

    debug('performing sibling check for %s', path);
    log(4,'SIBS:     %s', path);

    var sibs = await getNextFewSiblings(path, options.siblings);

    for (let sib of sibs) {
        debug('request load of sibling %s', sib);
        worker.push(() => cacheFile(sib));
    }
}

/*
 * to find the next few siblings, we query the database
 */
async function getNextFewSiblings(path, qty) {
    var parent = path.parent();
    var rgx = new RegExp('^' + parent + '/.*');

    // find all files matching the same parent
    var recs = await db.find({_id: rgx});

    var sibs = recs
        // just use the filepaths
        .map(rec => rec._id)
        // sort them
        .sort();

    sibs = sibs
        // cut everything before me
        .slice(sibs.indexOf(path+''))
        // and just choose next few
        .slice(1, qty + 1)
        // convert back to Path objects
        .map(n => new Path(n));

    debug('next few siblings=%o', sibs);
    return sibs;
}

/*
 * Startup housekeeping
 *
 * - reconcile the database with the physical files (source & cache)
 * - remove old files to prune the cache
 * - compact the database
 */

async function load() {
    debug('loading');

    options.load();
    log(2,'Reloading files');

    await syncDatabase();
    await pruneFiles();
    await db.compact();
    debug('loaded');

    var size = await getCacheSize();
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

async function syncDatabase() {
    debug('syncing database');

    // we gather all the files in the cache & source dirs
    var srcMap, cacheMap, dbMap;

    [ srcMap, cacheMap, dbMap ] = await Promise.all([
        scanFiles(false),   // source dir
        scanFiles(true),    // cache dir
        scanDB()            // db records
    ]);

    await Promise.all([
        updateSourceFiles(srcMap, cacheMap, dbMap),
        removeCacheFiles(srcMap, cacheMap),
        removeCacheEntries(srcMap, dbMap)
    ]);

    await db.update(
        {mru: {$exists: false}},
        {$set: {mru: new Date()}},
        {multi: true}
    );
}

/*
 * returns a map of path -> pathObject
 *
 * filters pathobjects to files matching the options
 * adjusts paths back to virtual paths (but keeping metadata)
 */
async function scanFiles(cached) {
    var scan = new PathScan(
        util.realFile('',cached), {collect: true});

    await scan.wait();

    return new Map(
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
    );
}

/*
 * returns a map of the database
 */

async function scanDB() {
    var recs = await db.find({});

    return new Map(
        recs.map(rec => [rec._id, rec])
    );
}

/*
 * updates the database from the source files, setting
 * cached depending on whether they are cached
 */
async function updateSourceFiles(srcMap, cacheMap, dbMap) {

    // first we workout which of the src files need updating
    var updates = Array.from(srcMap.values())
    .filter(p => {
        if (!dbMap.has(p.path))
            return true; // was not in db
        var rec = dbMap.get(p.path);
        if (rec.cached != cacheMap.has(p.path) ||
            rec.size != p.meta.size)
            return true;
        return false;
    });

    debug('updated files = %o', updates);
    await Promise.all(
        updates.map(p => db.update(
            {_id: p.path},
            {$set: {size: p.meta.size,
                    cached: cacheMap.has(p.path)}},
            {upsert: true}
        ))
    );
}

/*
 * removes old files, parent dirs for any files
 * in the cache no longer in the source
 */
async function removeCacheFiles(srcMap, cacheMap) {
    var oldFiles = Array.from(cacheMap.values())
        .filter(p => !srcMap.has(p.path));
    debug('old files = %o', oldFiles);

    await Promise.all(oldFiles.map(
        async p => {
            await db.remove({_id: p.path});
            await removeCacheFile(p);
        }
    ));
}

/*
 * removes a file and its parent dirs
 */
async function removeCacheFile(path) {
    var f = util.realFile(path, true);
    await f.unlink();
    await f.parent().rmdirs({stopAt: util.realFile('', true)});
}

/*
 * removes old database entries no longer in the source
 */
async function removeCacheEntries(srcMap, dbMap) {
    var oldEntries = Array.from(dbMap.keys())
        .filter(s => !srcMap.has(s));
    debug('old entries = %o', oldEntries);

    await Promise.all(oldEntries.map(s =>
        db.remove({_id: s})
    ));
}

async function pruneFiles() {
    debug('prune files');

    var size = await getCacheSize();

    while(size > options.cachesize) {
        debug('size is too big at %d. need to remove one', size);

        let rec = await db.cfindOne({cached: true})
            .sort({mru: 1})
            .exec();

        if (!rec) { break }

        debug('least recently used = %o', rec);
        await db.update({_id: rec._id},
            {$set: {cached: false}});

        await removeCacheFile(rec._id);
        log(2,"UNCACHED: %s", rec._id);
        size -= rec.size;
    }

    debug('files pruned');
}

async function getCacheSize() {
    var recs = await db.find({cached: true});

    var size = recs.reduce((sum, rec) => sum + rec.size, 0);

    debug('Total size=%d', size);
    return size;
}

module.exports = {
    start:          start,
    stop:           stop,
    find:           find,
    cacheFile:      cacheFile,
    cacheSiblings:  cacheSiblings,
    load:           load
};


