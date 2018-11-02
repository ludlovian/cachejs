'use strict'

const tap = require('tap')
const sinon = require('sinon')

tap.test('cleaner', async t => {
  const cleaner = require('../lib/cleaner')
  const { fs, vol } = require('memfs')
  const options = {
    ignoreFilter: /1\.flac/,
    cleanAfter: 30,
    cache: '/cache',
    fs
  }

  const data = 'data'
  const path1 = '/cache/file1.flac'
  const path2 = '/cache/file2.flac'
  const path3 = '/cache/subdir/file3.flac'
  const path4 = '/cache/subdir/file4.flac'

  vol.reset()
  vol.fromJSON({
    [path1]: data,
    [path2]: data,
    [path3]: data,
    [path4]: data
  })

  const events = []
  const errors = []
  cleaner.on('clean', events.push.bind(events))
  cleaner.on('error', errors.push.bind(errors))
  t.afterEach(async () => {
    events.splice(0)
    errors.splice(0)
  })

  t.test('run cleaner with no files old enough', async t => {
    const res = await cleaner.clean(options)

    t.strictSame(events, [], 'no events')
    t.strictSame(events, res, 'events retured')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('run cleaner when some files old enough', async t => {
    const earlier = (Date.now() / 1000) - 60
    fs.utimesSync(path2, earlier, earlier)
    fs.utimesSync(path4, earlier, earlier)

    const res = await cleaner.clean(options)

    t.strictSame(events.sort(), [ path2, path4 ], 'events fired')
    t.strictSame(events, res, 'events retured')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('run cleaner when readdir fails', async t => {
    const err = new Error('oops')
    t.tearDown(async () => sinon.restore())
    sinon.replace(require('fs'), 'readdir', sinon.fake.yieldsAsync(err))

    const res = await cleaner.clean()

    t.strictSame(events, [], 'no events')
    t.strictSame(events, res, 'events retured')
    t.strictSame(errors, [ err ], 'error emitted')
  })
})
