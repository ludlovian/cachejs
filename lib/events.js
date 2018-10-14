
'use strict';

const
  log = require('./log'),
  CacheFile = require('./cachefile'),
  { de, bug } = require('./debug')('events');

/*
 * called whenever a file is opened
 */

exports.onOpen = function onOpen(file) {

  // was the file cached?
  de&&bug('onOpen %s', file.realpath);

  var cf = new CacheFile(file.realpath);

  if (cf.canCache()) {
    log(3, `${cf.isCached() ? 'HIT ' : 'MISS'}    ${cf.path}`);
    cf.wasOpened();
  } else {
    log(4, `READ    ${cf.path}`);
  }

}

exports.onClose = function onClose(file) {

  de&&bug('onClose %s', file.realpath);
  var cf = new CacheFile(file.realpath);

  if (cf.isOpen()) {
    cf.wasClosed();
  }
};

exports.onRead = function onRead(file, stats) {
  de&&bug('onRead %s', file.realpath);

  var cf = new CacheFile(file.realpath);

  cf.wasRead(stats.bytesRead);
}
