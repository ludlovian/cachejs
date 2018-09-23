'use strict';

const
  tap = require('tap'),
  test = tap.test,
  Path = require('pathlib'),
  PathScan = require('pathscan'),

  root = Path.create('test');

test('teardown environment', async t => {
  const dirs = [ 'cache', 'mount', 'source' ];

  await Promise.all(dirs
    .map(async dir => {
      const scan = new PathScan(root.join(dir), {
        collect: true })
      await scan.wait();
      const files = scan.files.sort().reverse();
      for (let file of files) {
        if (file.meta.type === 'dir') {
          await file.rmdir();
        } else {
          await file.unlink();
        }
      }
    })
  );

  t.pass('torn down');
});

