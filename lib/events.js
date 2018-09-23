
'use strict';

const
  log = require('./log'),

  CacheFile = require('./cachefile'),

  Debug = require('debug'),
  debug = Debug('cachejs:events');

const openFiles = new Map();

/*
 * called whenever a file is opened
 */

exports.onOpen = function onOpen(file) {

  const path = file.path.toString();
  debug('onOpen %s', path);

  if (CacheFile.canCache(path)) {
    log(3, `READ ${path}`);

    // istanbul ignore else
    if (!openFiles.has(path)) {
      const cacheFile = new CacheFile(path);
      openFiles.set(path, cacheFile);
      cacheFile.wasOpened();
    }
  } else {
    log(4, `READ ${path}`);
  }

}

exports.onClose = function onClose(file) {

  const path = file.path.toString();
  debug('onClose %s', path);

  const cacheFile = openFiles.get(path);
  if (cacheFile) {
    openFiles.delete(path);
    cacheFile.wasClosed();
  }
};


