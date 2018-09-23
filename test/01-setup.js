'use strict';

const
  tap = require('tap'),
  test = tap.test,
  Path = require('pathlib'),
  
  root = Path.create('test');

test('setup environment', async t => {
  const dirs = [ 'cache', 'mount', 'source', 'source/subdir' ];

  await Promise.all(
    dirs
      .map(dir => root.join(dir))
      .map(dir => dir.mkdirs())
  );

  t.pass('dirs made');

  for (let i=1; i<=9; i++) {
    const file = root.join(`source/track0${i}.flac`);
    await file.write(`data0${i}`);
  }

  await root.join('source/metadata.json').write('some data');

  await root.join('source/subdir/track10.flac').write('data10');

  t.pass('files made');
});

