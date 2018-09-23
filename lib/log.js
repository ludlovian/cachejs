'use strict';

const util = require('util'),
  Debug = require('debug'),
  debug = Debug('cachejs:log');

function log(level, ...args) {
  const config = require('./config');

  if (level > config.logLevel) {
    return;
  }
  var s = util.format.apply(util, args);
  // istanbul ignore else
  if (log.dummy) {
    debug(s);
    log.lines.push(s);
  } else {
    console.log(s);
  }
}

log.dummy = false;
log.lines = [];

module.exports = log;

