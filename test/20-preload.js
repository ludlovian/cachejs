'use strict';

const Path = require('pathlib'),
  { setConfig, clearLog, getCachedFiles, readFile } = require('./util'),
  tap = require('tap'),
  test = tap.test;

setConfig({
  logLevel: 5,
  preload: {
    openDelay: 100,
  },
});

clearLog();

test('preload', async t => {
  const cachejs = require('..'),
    worker = require('../lib/worker'),
    log = require('../lib/log');

  await cachejs.start();
  t.pass('started');

  await Promise.all([
    t.test('basic preload', async t=> {

      const f = Path.create('test/mount/track02.flac');
      await readFile(t, f, 200);
      await worker.idle();

      const files = await getCachedFiles();
      t.deepEqual(files, ['track02.flac', 'track03.flac', 'track04.flac', 'track05.flac'], 'four files preloaded');

    }),

    t.test('preload with some already loaded', async t => {
      const f = Path.create('test/mount/track01.flac');
      log.lines.splice(0);

      //await readFile(t, f, 200);
      await f.read('utf8');
      await worker.idle();

      const files = await getCachedFiles();
      t.deepEqual(files, ['track01.flac', 'track02.flac', 'track03.flac', 'track04.flac', 'track05.flac'], 'five files preloaded');
      t.match(log.lines, [ /^MISS {4}/, /^SIBS {4}/, /^CACHE {3}/], 'right log lines printed');
    }),

    t.test('read a non-cached file', async t => {
      const f = Path.create('test/mount/metadata.json');
      log.lines.splice(0);

      await readFile(t, f, 200);
      await worker.idle();

      const files = await getCachedFiles();
      t.equal(files.length, 5, 'no more files cached');
      t.match(log.lines, [ /^READ {4}/ ], 'right log lines printed');
    }),

    t.test('read a file in subdir', async t => {
      const f = Path.create('test/mount/subdir/track10.flac');
      log.lines.splice(0);

      await readFile(t, f, 200);
      await worker.idle();

      const files = await getCachedFiles();
      t.equal(files.length, 6, 'file was cached');
      t.match(log.lines, [ /^MISS {4}/, /^SIBS {4}/, /^CACHE {3}/], 'right log lines printed');
    }),

    t.test('read a file already cached', async t => {
      const f = Path.create('test/mount/subdir/track10.flac');
      log.lines.splice(0);

      await readFile(t, f, 200);
      await worker.idle();

      const files = await getCachedFiles();
      t.equal(files.length, 6, 'file was cached');
      t.match(log.lines, [ /^HIT {5}/, /^SIBS {4}/ ], 'right log lines printed');
    }),
  ]);

  await cachejs.stop('keepAlive');
});

