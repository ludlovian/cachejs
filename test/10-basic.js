'use strict';

const Path = require('pathlib'),
  { setConfig, clearLog } = require('./util'),
  tap = require('tap'),
  test = tap.test;

setConfig({
  logLevel: 5
});

clearLog();

test('basic running', async t => {
  const cachejs = require('..'),
    config = require('../lib/config'),
    log = require('../lib/log');

  return Promise.all([
  
    t.test('start and stop', async t => {

      log.lines.splice(0);

      await cachejs.start();
      t.pass('started ok');

      await cachejs.stop('keepAlive');
      t.pass('stopped ok');

      t.equal(log.lines.length, 4, '4 log lines written');
    }),

    t.test('suppressing log', async t => {
      config.logLevel = 0;
      log.lines.splice(0);

      await cachejs.start();
      t.pass('started ok');

      await cachejs.stop('keepAlive');
      t.pass('stopped ok');

      t.equal(log.lines.length, 0, 'no log lines written');
      config.logLevel = 5;

    }),

    t.test('basic read', async t => {
      await cachejs.start();
      t.pass('started ok');

      const f = Path.create('./test/mount/track03.flac');
      const data = await f.read('utf8');
      t.equal(data, 'data03', 'file read ok');

      await cachejs.stop('keepAlive');
      t.pass('stopped ok');

    }),

  ]);
});


