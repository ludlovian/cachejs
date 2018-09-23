'use strict';

const PathScan = require('pathscan'),
  _ = require('lodash'),
  { promisify } = require('util'),
  fs = require('fs'),
  delay = promisify(setTimeout),
  open = promisify(fs.open),
  close = promisify(fs.close),
  tap = require('tap'),
  test = tap.test;

exports.getCachedFiles = async function getCachedFiles() {
  const scan = new PathScan('test/cache', {collect: true});
  await scan.wait();

  return scan.files
    .filter(file => file.meta.type === 'file')
    .map(file => file.name())
    .sort();
};

exports.clearLog = function clearLog() {
  test('clear log', async t => {
    const log = require('../lib/log');
    log.dummy = true;
    log.lines.splice(0);
    t.pass('log cleared');
  });
};

exports.setConfig = function setConfig(extra = {}) {
  test('set config', async t => {

    const config = require('../lib/config');
    process.env.NODE_ENV='test';
    await config.reload();
    _.merge(config, extra);
    t.equal(config.dirs.source, './test/source', 'config set');
  });
};

exports.readFile = async function readFile(t, f, delayPeriod=200) {

  const fd = await open(f.path, 'r');
  t.pass('file opened ok');

  await delay(delayPeriod);

  await close(fd);
  t.pass('file closed ok');
}
