/*
 * CacheFile is cacheable
 *
 */


'use strict';

/*
 * Requires & promisifieds
 */


const debug = require('debug')('cachejs:cachefile')
    , fs = require('fs-extra')
    , thenify = require('thenify')

    , openFile = thenify(fs.open)
    , closeFile = thenify(fs.close)

    , cache = require('./cache')
    , PassthruFile = require('./passthru')
    , log = require('./util').log
    , Recent = require('./recent')

    ;


/* CacheFile
 *
 * uses a cached version if it exists. Tells the cache about my usage
 * so that it can cache the files if it wants.
 *
 * Can swtich files midstream if cached
 */

class CacheFile extends PassthruFile {
    constructor(realRoot, cacheRoot, path) {
        super(realRoot, path)
        debug('creating cachefile for %s', path);
        this.realRoot = realRoot;
        this.cacheRoot = cacheRoot;
    }

    inspect() {
        return 'CacheFile(' + this.path + ')';
    }

    async open() {
        // try opening the cache version first
        debug('open')
        var cached = cache.isCached(this.path);
        log(3, '%s     %s', (cached ? 'HIT: ' : 'MISS:'), this.path);

        this.root = (cached ? this.cacheRoot : this.realRoot);
        await super.open();

        var recent = Recent.create(this.path);
        recent.onOpened();
        if (!cached) {
            recent.on('cached', () => this.switchToCached());
        }
    }

    async close() {
        await super.close();
        var recent = Recent.locate(this.path);
        if (recent) {
            recent.onClosed();
        }
    }

    async switchToCached() {
        /* called to switch FDs to the cache version.
         * have to do this carefully in case the file gets closed
         * as we are doing it
         */
        if (!this.isOpen) { return; }

        debug('switching to cached for %s', this.path);
        this.root = this.cacheRoot;
        var cacheFile = this.realFile();

        // open the new file
        var cacheFD = await openFile(cacheFile.path, 'r');

        // bomb out if already closed
        if (!this.isOpen)
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

module.exports = CacheFile;


