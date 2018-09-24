'use strict';

const
  Path = require('pathlib'),
  _ = require('lodash'),

  config = require('./config'),
  worker = require('./worker'),
  log = require('./log'),
  { copyFile } = require('./util'),

  Debug = require('debug'),
  debug = Debug('cachejs:cachefile');


class CacheFile {
  static canCache(path) {
    const filter = new RegExp(config.preload.filter);
    return filter.test(Path.create(path).name());
  }

  constructor(path) {
    this.path = Path.create(path);
    debug('constructed %s', path);
  }

  wasOpened() {
    // istanbul ignore else
    if (!this.openTimer) {
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        this.requestPreload();
      }, config.preload.openDelay);
    }
  }

  wasClosed() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }

  realpath(rootName) {
    return Path.create(config.dirs[rootName]).join(this.path);
  }


  requestPreload() {
    worker.push(`sib check for ${this.path}`, () => this.cacheSibs());
  }

  requestCache() {
    worker.push(`cache ${this.path}`, () => this.cacheFile());
  }

  async cacheSibs() {
    const filter = new RegExp(config.preload.filter),
      num = config.preload.siblings;

    log(3, `SIBS    ${this.path}`);

    const allSibs = await this.realpath('source')
      .parent()
      .readdir();

    const sibsToLoad = _.chain(allSibs)
      .filter(file => filter.test(file.name()))
      .sortBy(file => file.name())
      .dropWhile(file => file.name() !== this.path.name())
      .drop(1)
      .take(num)
      .map(file => this.path.withName(file.name()))
      .map(path => new CacheFile(path))
      .value();

    this.requestCache();
    sibsToLoad.forEach(sib => sib.requestCache());
  }

  async cacheFile() {
    const srcFile = this.realpath('source'),
      cacheFile = this.realpath('cache');

    const exists = await cacheFile.exists();
    if (!exists) {
      log(2, `CACHE   ${this.path}`)
      await copyFile(srcFile, cacheFile);
    }
  }

}

module.exports = CacheFile;
