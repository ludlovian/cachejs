'use strict';

// set up the physical test files

const Path = require('pathlib'),
  root = Path.create('test'),
  { execSync } = require('child_process'),

  tap = require('tap'),
  test = tap.test;
  

test('setup environment', async t => {
  [ 'cache', 'mount', 'source' ].forEach(dir =>
    execSync(`rm test/${dir}/ -rf`));

  await Promise.all(
    [ 'cache', 'mount', 'source', 'source/subdir' ]
    .map(dir => root.join(dir).mkdirs())
  );

  await Promise.all(
    [
      { path: 'source/track01.flac', content: 'data01' },
      { path: 'source/track02.flac', content: 'data02' },
      { path: 'source/track03.flac', content: 'data03' },
      { path: 'source/track04.flac', content: 'data04' },
      { path: 'source/track05.flac', content: 'data05' },
      { path: 'source/track06.flac', content: 'data06' },
      { path: 'source/track07.flac', content: 'data07' },
      { path: 'source/track08.flac', content: 'data08' },
      { path: 'source/track09.flac', content: 'data09' },

      { path: 'source/metadata.json', content: 'some data' },

      { path: 'source/subdir/track10.flac', content: 'data10' },
    ].map(f => root.join(f.path).write(f.content))
  );

  t.pass('files made');
});

