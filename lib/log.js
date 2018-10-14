'use strict';

const util = require('util'),
  { de, bug } = require('./debug')('log');

function log(level, ...args) {
  const config = require('./config');

  if (level > config.logLevel) {
    return;
  }
  var s = util.format.apply(util, args);
  // istanbul ignore else
  if (log.dummy) {
    de&&bug(s);
    log.lines.push(s);
  } else {
    console.log(s);
  }
}

log.dummy = false;
log.lines = [];

module.exports = log;

