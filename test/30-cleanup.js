'use strict';

const { promisify } = require('util'),
  delay = promisify(setTimeout),

  { setConfig, clearLog, getCachedFiles } = require('./util'),
  tap = require('tap'),
  test = tap.test;

setConfig({
  logLevel: 5,
  preload: {
    openDelay: 100,
  },
});

clearLog();

test('cleanup', async t => {
  const cachejs = require('..'),
    worker = require('../lib/worker'),
    config = require('../lib/config');

  await cachejs.start();
  t.pass('started');

  await Promise.all([
    t.test('cleanup with nothing due', async t=> {
      const f1 = await getCachedFiles();
      t.ok(f1.length, 'some files are cached');

      config.cleanup.cleanAfter=3600;

      // do a clean
      cachejs.requestCleanup();
      await worker.idle();

      const f2 = await getCachedFiles();
      t.equal(f2.length, f1.length, 'nothing cleaned');

    }),

    t.test('full cleanup', async t=> {
      const f1 = await getCachedFiles();
      t.ok(f1.length, 'some files are cached');

      // set the clean interval really short
      config.cleanup.cleanAfter=0.1; // 0.1 seconds
      await delay(200);

      // do a clean
      cachejs.requestCleanup();
      await worker.idle();

      const f2 = await getCachedFiles();
      t.deepEqual(f2, ['track01.flac'], 'everything cleaned but one');

    }),

    t.test('empty cleanup', async t=> {
      // do a clean
      cachejs.requestCleanup();
      await worker.idle();

      const f2 = await getCachedFiles();
      t.deepEqual(f2, ['track01.flac'], 'everything cleaned but one');
    }),

  ]);

  await cachejs.stop('keepAlive');
});

