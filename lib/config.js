/*
 * Options loading
 *
 */

'use strict';

/*
 * Requires & promisifieds
 */

const
  Path = require('pathlib'),
  _ = require('lodash'),

  version = require('../package').version,

  Debug = require('debug'),
  debug = Debug('cachejs:config');

class Config {
  constructor() {
  }

  get version() { return version; }

  // resets the options object from the local files
  async load() {
    if (this.loaded)
      return;
    // clear current object data;
    _.forOwn(this, (v, k) => { this[k] = undefined; });

    // find the file
    /* istanbul ignore next */
    const env = (process.env.NODE_ENV || 'development').toLowerCase();
    const files = [
      'default.json',
      env + '.json',
    ];

    // override with files
    files
      .map(file => process.cwd() + '/config/' + file)
      .forEach(file => {
        var data = null;
        try {
          const filePath = require.resolve(file);
          delete require.cache[filePath];
          data = require(filePath);
        } catch (e) {
          // ignore errors
          // istanbul ignore next
        }
        // istanbul ignore else
        if (data)
          _.merge(this, data);
    });

    // late binding of util to stop circular references
    await this.validate();
    this.loaded = true;
    debug('config is now %o', module.exports);

    return this;
  }

  async reload() {
    this.loaded = false;
    return this.load();
  }

  async validate() {
    // istanbul ignore next
    if (this.valid) return true;
    // make sure all the dirs exist
    await Promise.all(
      _.keys(this.dirs)
      .map(key => Path.create(this.dirs[key]).load())
    );

    this.valid = true;
  }
}

module.exports = new Config();

