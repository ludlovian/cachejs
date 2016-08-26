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
 *  start/stop  - to start & stop the stuff
 *  find        - promise of a cache entry (& inc refcount)
 *  release     - decrease refcount
 *  requestLoad - queue the load
 *  housekeep   - queue the housekeeping
 *
 * The cache is a set of files, coupled with an NEDB database
 * of mru times & sizes (for easier pruning)
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:cache')
  , Promise = require('pixpromise')
  , options = require('./options')
  , log = options.log
  , Path = require('pathlib')
  , db = require('./db')
  , pevent = require('./pevent')
  , worker = require('./worker')

  ;

// the root of the underlying filesystem
var root = Path(options.source)
  , cacheroot = Path(options.cachedir)
  , currentPath = new Path()
  ;


/* start & stop */
function /*Promise*/ start() {
    debug('starting');

    // start the database
    return db.start()

    // start the worker and do first housekeeping
    .then(() => _startWorker())

    .then(() => debug('started'));
}
exports.start = start;

function /*Promise*/ _startWorker() {
    worker.onIdle(options.housekeep, housekeep);
    return worker.push(housekeep);
}

function /*Promise*/ stop() {
    debug('stopping');
    return worker.stop()
    .then(() => db.stop())
    .then(() => debug('stopped'));
}
exports.stop = stop;

/*
 * Find
 *
 * find(path,opts)
 *
 * Promise of the cache record
 * options:
 * - noref  do not incref, just return the record (null if no record)
 * - nopath do not set the current path
 *
 */
function /*Promise*/ find(path, opts) {
    opts = opts || {};
    path = Path(path);
    if (!opts.nopath)
        currentPath = path;

    debug('find %s %o', path, opts);
    var prec;
    if (opts.noref) {
        prec = db.findOne({_id: path+''});
    } else {
        prec = db.update(
                    {_id: path+''},
                    {$inc: {refcount: 1}, $set: {mru: new Date()}},
                    {upsert:true, returnUpdatedDocs: true}
                ).then(result => result.docs);
    }
    return prec
    .then(rec => {
        if (!rec.cached) {
            rec.file = root.join(path);
        } else {
            rec.file = cacheroot.join(path);
        }
        debug('found: %o', rec);
        return rec;
    });
}
exports.find = find;

function /*Promise*/ release(path) {
    debug('release %s', path);
    return db.update(
            {_id: path+''},
            {$inc: {refcount: -1}}
            );
}
exports.release = release;

/*
 * requestLoad
 *
 * Request that a load be queued
 *
 */
function requestLoad(path) {
    worker.push(() => loadFile(path, {loadSiblings: true}));
}
exports.requestLoad = requestLoad;

/* loadFile
 *
 * Loads a file into the cache (maybe)
 *
 * options:
 * - preload        are we preloading?
 * - loadSiblings   should we consider loading siblings after
 *
 *
 * Unless we are preloading, we don't bother if there are no active
 * files (refcount>0)
 */

function /*Promise*/ loadFile(path, opts) {
    opts = opts || {};
    path = Path(path);

    debug('loadFile %s %o', path, opts);

    // get the cache record for this file (which may or may not
    // exist, so we upsert it)
    return db.update(
        {_id: path+''},
        {$inc: {refcount: 0}},
        {upsert: true, returnUpdatedDocs: true}
    ).then(result => result.docs)
    .then(rec => {
        if (!rec)
            return false; // no record of file

        if (!opts.preload && !rec.refcount)
            return false; // not preloading, but no-one is using it

        // copy the file over
        return copyFileToCache(path)

        // update the database to say it is cached
        .then(file =>
            db.update(
                {_id: path+''},
                {$set: {cached: true, size: file.meta.size, mru: new Date()}}
            ))
        .tap(() => log("%s cached", path))

        // emit the loaded event
        .then(() => pevent.emit(path, 'loaded'))
        .then(() => pevent.clear(path))

        // prune the cache if now too big
        .then(() => pruneFiles())

        // queue the load of siblings if requested
        .then(() => {
            if (opts.loadSiblings) {
                worker.push(() => loadSiblings(path));
            }
        })
        .then(() => true); // return true as we did load it
    })
    .done(); // all errors fatal
}

function /*Promise*/ copyFileToCache(path) {
    /* Copies a file from source to cache, returning
     * the loaded path of the cached file
     */
    var src = root.join(path);
    var dst = cacheroot.join(path);

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
 * loadSiblings
 *
 * A request to load the siblings of a given path
 *
 * We bomb out if we have changed path
 *
 */

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
    // filter those that do not yet exist in the cache dir
    .filter(f => cacheroot.join(f)
                    .exists()
                    .then(exists => !exists))
    // and add to the work queue
    .mapSeries(sib => {
        debug('queueing preload of %s', sib);
        worker.push(() => loadFile(sib, {preload: true}));
    })
    .done(); // all errors fatal
}


function _onSameDirectoryAs(path) {
    return currentPath.parent().path === path.parent().path;
}


/*
 * Housekeeping
 *
 * Periodically, we
 * - reconcile the database with the physical files
 * - remove old files to prune the cache
 * - compact the database
 */

function /*Promise*/ housekeep() {
    debug('housekeeping');

    return syncDatabase()
    .then(() => pruneFiles())
    .then(() => db.compact())
    .tap(() => debug('housekept'))
    .done();
}
exports.housekeep = () => worker.push(housekeep);

function /*Promise*/ syncDatabase() {
    var cacherootlen = (cacheroot+'').length;

    debug('syncing database');

    var oldFiles;
    // first we collect all files and say they are potentially old
    return db.find({})
    .then(recs => {
        oldFiles = new Set(recs.map(rec => rec._id));
    })

    // then we scan all the files in cache
    .then(() => scanCacheFiles())

    // and upsert the database records accordingly
    .map(f => {
        var path = f.path.slice(cacherootlen);
        // we've seen this file, so it's not old
        oldFiles.delete(path);
        return db.update(
            {_id: path},
            {$set: {size: f.meta.size, cached: true}},
            {upsert: true}
        );
    })

    // add in fresh MRUs for recently added
    .then(() => db.update(
            {mru: {$exists: false}},
            {$set: {mru: new Date()}},
            {multi: true}
    ))

    // remove uncached (old) records
    .then(() => Array.from(oldFiles))
    .tap(old => debug("Removing old files: %o", old))
    .map(p => db.remove({_id: p}))

    // remove any uncached no refcounts
    .then(() => db.remove(
        {refcount: 0, cached: {$exists: false}}
    ))

    // all errors are fatal
    .tap(() => debug('sync database complete'))
    .done();
}

/*
 * scanCacheFiles
 *
 * scans the actual files in the cache, and returns an array
 * of loaded path objects
 *
 */
function /*Promise*/ scanCacheFiles() {
    var files = []
      , prefix = (cacheroot + '').length
      ;

    return cacheroot.scan()
    .on('file', f => {
        if (f.meta.type !== 'file')
            return;
        if (f.name() === 'cache.db')
            return;
        if (!options.filter(f.path.slice(prefix)))
            return;
        files.push(f);
    })
    .then(() => files);
}

function /*Promise*/ pruneFiles() {
    debug('prune files');
    return getTotalSize()
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
            {size: {$exists: true}, cached: true},
            {sort: {mru: 1}}
    )
    .then(rec => {
        if (!rec) return;
        debug('least recently used = %o', rec);
        var file = cacheroot.join(rec._id);
        if (!file.path.startsWith(cacheroot))
            throw new Error("Eek. Trying to delete " + file);
        return file.unlink()
        .then(() => file.parent().rmdirs(cacheroot))
        .tap(() => log(rec._id + " uncached"))
        .then(() => db.remove({_id: rec._id}))
        .then(() => _pruneFiles(size - rec.size));
    })
    .done();
}

function /*Promise*/ getTotalSize() {
    return db.find({size: {$exists: true}})
    .then(recs => recs.reduce((sum, rec) => sum + rec.size, 0))
    .tap(size => debug('Total size=%d', size));
}


