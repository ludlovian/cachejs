/*
 * File cache
 *
 * controls the cache loading and housekeeping of the cached files
 *
 * the public entry points are:
 *
 *  isCached                - tells if cached (updating mru)
 *
 *  async cacheFile         - caches a file
 *  async cacheSiblings     - caches the siblings of a file
 *
 *  async scanCache         - re-scans the cache
 *
 */

'use strict';

/*
 * Requires & promisifieds
 */

const debug = require('debug')('cachejs:cache')
    , shuffle = require('shuffle-array')
    , Path = require('pathlib')
    , Cmd = require('cmd')
    , PathScan = require('pathscan')
    , options = require('./options')
    , util = require('./util')
    , log = util.log
    , worker = require('./worker')
    ;


/*
 * the metadata for the cache
 */

var cacheEntries = new Map(); // {size: }

/*
 * isCached -> bool
 *
 * tells if a path is cached. Updates the mru order.
 *
 */
function isCached(path) {
    var entry = cacheEntries.get(path.path);
    if (entry) {
        // the action of delete & re-add brings it to the end of the
        // list, so the keys are in least-recently-used order
        cacheEntries.delete(path.path);
        cacheEntries.set(path.path, entry);
    }
    return !!entry;
}


/* cacheFile
 *
 * Loads a file into the cache (maybe)
 *
 * returns true if loaded
 */

async function cacheFile(path) {
    debug('cacheFile %s', path);

    if (cacheEntries.has(path.path)) {
        return false; // already cached apparently
    }

    var src = options.source.join(path);
    var dst = options.cache.join(path);

    dst = await util.copyFile(src, dst);
    cacheEntries.set(path.path, { size: dst.meta.size });

    log(2, "CACHED:   %s", path);

    // queue a prune if needed
    if (calcCacheSize() > options.cachesize) {
        worker.push('prune files', pruneFiles);
    }

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
        worker.push(`cache file: ${sib}`, () => cacheFile(sib));
    }
}


/*
 * to find the next few siblings, we read the directory
 */
async function getNextFewSiblings(path, qty) {
    var srcDir = options.source.join(path).parent();

    var sibs = await srcDir.readdir();

    // turn from Path objs into strings
    sibs = sibs.map(p => p.path.slice(options.source.path.length))
    // sorted
    .sort();

    // now cut everything before me
    sibs = sibs
        // cut everything before me
        .slice(sibs.indexOf(path.path))
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
 * - reconcile the source with the cache
 * - rescan the cache
 * - prune the database
 */

async function load() {
    debug('loading');

    options.load();
    log(2,'Reloading files');

    await updateCache();
    await scanFiles();
    await pruneFiles();
    debug('loaded');

    var size = calcCacheSize();
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
    log(1,'    touch trigger:   %d', options.touchLimit);
    log(1,'    recent window:   %d', options.recentCount);
    log(1,'    queue limit:     %d', options.queueLimit);
    log(1,'    FUSE opts:       %s', options.fuseOptions);


}

async function updateCache() {
    // updates the cache to be consistent with the source
    //
    // does this by rsync -rltWOJ --existing --delete
    //
    debug('syncing cache at %s', options.cache);
    debug('syncing from %s:', options.source);
    var rsync = new Cmd('rsync',
        [ '-rltWOJ', '--existing', '--delete', options.source.path + '/', options.cache.path + '/' ],
        { stdout:{}, stderr: {}, progress: {} });
    await rsync.wait();
    debug('cache synced');
}

async function scanFiles() {
    // scans the cache paths to find out what's in the cache
    debug('scanning files in the cache at %s', options.cache);

    var f = options.cache;
    var scan = new PathScan(f, {collect: true});
    await scan.wait();

    // only look at files
    scan.files = scan.files.filter(f => f.meta.type === 'file');

    // shuffle the files
    shuffle(scan.files);
    debug('%d files found', scan.files.length);

    // rebuild the new cache entries
    cacheEntries = new Map(
        scan.files.map(f =>
            [f.path.slice(options.cache.path.length), {size: f.meta.size}]
        )
    );
    debug('new cache has %d entries', cacheEntries.size);
}

async function pruneFiles() {
    // removes files until the cache is below the right size
    while (calcCacheSize() > options.cachesize) {
        debug('cache too big. must remove one');

        // remove the first one
        var entry = cacheEntries.entries().next().value;
        if (!entry) { break; }

        debug('oldest is: %s', entry[0]);
        debug('will free up %d bytes', entry[1].size);

        cacheEntries.delete(entry[0]);

        await removeCacheFile(entry[0]);
        log(2,"UNCACHED: %s", entry[0]);
    }
}

function calcCacheSize() {
    var size = 0;
    for (var entry of cacheEntries.values()) {
        size += entry.size;
    }
    debug('total cache size = %d', size);
    return size;
}


/*
 * removes a file and its parent dirs
 */
async function removeCacheFile(path) {
    var f = options.cache.join(path);
    await f.unlink();
    await f.parent().rmdirs({stopAt: options.cache});
}


module.exports = {
    isCached:       isCached,
    cacheFile:      cacheFile,
    cacheSiblings:  cacheSiblings,
    load:           load
};


