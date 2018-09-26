'use strict';

const
  Path = require('pathlib'),
  _ = require('lodash'),

  config = require('./config'),
  worker = require('./worker'),
  log = require('./log'),
  { copyFile, fatalError } = require('./util'),
  trigger = require('./trigger'),

  assert = require('assert'),
  Debug = require('debug'),
  debug = Debug('cachejs:cachefile');


class CacheFile {

  constructor(realpath) {
    assert.ok(realpath instanceof Path);

    // return one if already open
    const existing = CacheFile.openFiles.get(realpath.toString());
    if (existing) {
      return existing;
    }

    this.realpath = realpath;

    this.root = Path.create('/');
    for (let r of [ config.dirs.cache, config.dirs.source ]) {
      if (realpath.path.startsWith(r)) {
        this.root = Path.create(r);
        break;
      }
    }

    this.path = this.realpath.relativeTo(this.root);
    debug('constructed %o', this);
  }

  wasOpened() {

    // istanbul ignore if
    if (this.isOpen()) { // already open, so don't bother
      return;
    }
    CacheFile.openFiles.set(this.realpath.toString(), this);

    this.bytesRead = 0;
    this.preloadTrigger = trigger();
    this.preloadTrigger
      .then(v => this.requestPreload(v))
      .catch(fatalError);

    this.preloadTrigger.fireAfter(config.preload.openDelay, {
      reason: 'timeout'
    });
  }

  wasClosed() {
    CacheFile.openFiles.delete(this.realpath.toString());

    // cancel any preload if not yet fired
    this.preloadTrigger.cancel();
  }

  wasRead(bytesRead) {
    debug('%d bytes read', bytesRead);
    this.bytesRead += bytesRead;
    debug('%d bytes read in total', this.bytesRead);

    const fileSize = this.realpath.meta.size;
    debug('fileSize=%d', fileSize);

    if (this.bytesRead > config.preload.readPercentage * fileSize / 100) {
      debug('more than threshold: %d vs %d', this.bytesRead, fileSize);
      this.preloadTrigger.fire({
        reason: 'size'
      });
    }
  }

  canCache() {
    const filter = new RegExp(config.preload.filter);
    return filter.test(this.path.name());
  }

  isCached() {
    return this.root.path === config.dirs.cache;
  }

  isOpen() {
    return CacheFile.openFiles.has(this.realpath.toString());
  }

  onRoot(rootName) {
    return Path.create(config.dirs[rootName]).join(this.path);
  }

  requestPreload(v) {
    debug('preload requested of %s', this.path);
    worker.push(`preload ${this.path}`, () => this.cacheSibs(v.reason));
  }

  requestCache() {
    worker.push(`cache ${this.path}`, () => this.cacheFile());
  }

  async cacheSibs(reason) {
    const filter = new RegExp(config.preload.filter),
      num = config.preload.siblings;

    const logReason = reason === 'timeout' ? 'RQ-TIME' : 'RQ-SIZE';

    log(3, `${logReason} ${this.path}`);

    const allSibs = await this.onRoot('source')
      .parent()
      .readdir();

    const sibsToLoad = _.chain(allSibs)
      .filter(file => filter.test(file.name()))
      .sortBy(file => file.name())
      .dropWhile(file => file.name() !== this.path.name())
      .drop(1)
      .take(num)
      .map(file => new CacheFile(file))
      .value();

    this.requestCache();
    sibsToLoad.forEach(sib => sib.requestCache());
  }

  async cacheFile() {
    const srcFile = this.onRoot('source'),
      cacheFile = this.onRoot('cache');

    const exists = await cacheFile.exists();
    if (!exists) {
      log(2, `CACHE   ${this.path}`)
      await copyFile(srcFile, cacheFile);
    }
  }

}

CacheFile.openFiles = new Map();

module.exports = CacheFile;
