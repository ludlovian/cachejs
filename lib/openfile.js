'use strict';

const
  config = require('./config'),
  { requestPreload } = require('./preload'),

  Debug = require('debug'),
  debug = Debug('cachejs:openfile');

class OpenFile {
  constructor(path) {
    this.path = path;
    debug('constructed %s', path);
  }

  wasOpened() {
    debug('%s opened', this.path);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.preload();
    }, config.preload.openDelay);
  }

  wasClosed() {
    debug('%s closed', this.path);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  preload() {
    debug('preloading %s', this.path);
    requestPreload(this.path);
  }
}

module.exports = OpenFile;
