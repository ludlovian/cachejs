
'use strict';

const
  log = require('./log'),
  config = require('./config'),

  CacheFile = require('./cachefile'),

  Debug = require('debug'),
  debug = Debug('cachejs:events');

const openFiles = new Map();

/*
 * called whenever a file is opened
 */

exports.onOpen = function onOpen(file) {

  // was the file cached?
  debug('onOpen %o', file);

  const isCached = (file.root.path === config.dirs.cache);

  const path = file.path.toString();


  if (CacheFile.canCache(path)) {
    log(3, `${isCached ? 'HIT ' : 'MISS'}    ${path}`);

    // istanbul ignore else
    if (!openFiles.has(path)) {
      const cacheFile = new CacheFile(path);
      openFiles.set(path, cacheFile);
      cacheFile.wasOpened();
    }
  } else {
    log(4, `READ    ${path}`);
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


