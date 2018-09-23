'use strict';

const { setConfig, clearLog } = require('./util'),
  tap = require('tap'),
  test = tap.test;

setConfig({
  logLevel: 5
});

clearLog();

test('reloading', async t => {
  const cachejs = require('..'),
    worker = require('../lib/worker'),
    log = require('../lib/log');

  return Promise.all([
  
    t.test('basic reload', async t => {

      log.lines.splice(0);

      await cachejs.start();
      t.pass('started ok');

      await cachejs.reload();
      await worker.idle();

      t.ok(log.lines.length, 'reloaded ok');

      await cachejs.stop('keepAlive');
      t.pass('stopped ok');
    }),


  ]);
});


