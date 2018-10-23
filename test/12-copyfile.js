'use strict'

const tap = require('tap')
const sinon = require('sinon')

tap.test('copyFile', async t => {
  const copyFile = require('../lib/copyfile')
  const { vol, fs } = require('memfs')
  copyFile.fs = fs

  t.beforeEach(async () => {
    vol.reset()
    vol.fromJSON({ '/src/foo': 'bar' })
  })

  t.test('copying a file', async t => {
    await copyFile('/src/foo', '/baz')

    t.match(vol.toJSON(), {
      '/src/foo': 'bar',
      '/baz': 'bar'
    }, 'file copied ok')

    const s1 = vol.statSync('/src/foo')
    const s2 = vol.statSync('/baz')
    t.strictEqual(s1.size, s2.size, 'files have same size')
    t.ok(Math.abs(s1.mtimeMs - s2.mtimeMs) < 1000, 'files have same mtime')
  })

  t.test('copying a file under a new subdir', async t => {
    await copyFile('/src/foo', '/dst/foo/baz')

    t.match(vol.toJSON(), {
      '/src/foo': 'bar',
      '/dst/foo/baz': 'bar'
    }, 'subdirs made ok')
  })

  t.test('copying a file over identical clone', async t => {
    await copyFile('/src/foo', '/baz')
    t.tearDown(async () => sinon.restore())
    const cp = sinon.fake(fs.copyFile)
    sinon.replace(fs, 'copyFile', cp)

    await copyFile('/src/foo', '/baz')
    t.equal(cp.callCount, 0, 'copying skipped')
  })

  t.test('copying a file over different file', async t => {
    vol.writeFileSync('/baz', 'xuuq')
    await copyFile('/src/foo', '/baz')
    t.match(vol.toJSON(), {
      '/src/foo': 'bar',
      '/baz': 'bar'
    }, 'file copied ok')
  })

  t.test('copying a missing file', t => {
    copyFile('/src/quux', '/dst/quux')
      .catch(err => {
        t.match(err, { code: 'ENOENT' }, 'error thrown')
        t.match(vol.toJSON(), {
          '/src/foo': 'bar',
          '/dst': null
        }, 'no file copied (but subdir made)')

        t.done()
      })
  })

  t.test('when copyFile throws', t => {
    t.tearDown(async () => sinon.restore())
    const err = new Error('bazbar')
    sinon.replace(fs, 'copyFile', sinon.fake.yieldsAsync(err))
    copyFile('/src/foo', '/baz')
      .catch(e => {
        t.strictSame(e, err, 'error thrown')
        t.match(vol.toJSON(), {
          '/src/foo': 'bar'
        }, 'temp file removed')
        t.done()
      })
  })

  t.test('when the rename throws an error', t => {
    t.tearDown(async () => sinon.restore())
    const err = new Error('bazbar')
    sinon.replace(fs, 'rename', sinon.fake.yieldsAsync(err))

    copyFile('/src/foo', '/baz')
      .catch(e => {
        t.strictSame(e, err, 'error thrown')
        t.match(vol.toJSON(), {
          '/src/foo': 'bar'
        }, 'temp file removed')
        t.done()
      })
  })

  t.test('when the rename and unlink both throw errors', t => {
    t.tearDown(async () => sinon.restore())
    const err1 = new Error('bazbar')
    const err2 = new Error('barbaz')
    sinon.replace(fs, 'rename', sinon.fake.yieldsAsync(err1))
    sinon.replace(fs, 'unlink', sinon.fake.yieldsAsync(err2))

    copyFile('/src/foo', '/baz')
      .catch(e => {
        t.strictSame(e, err2, 'unlink error thrown')
        t.strictSame(e.context, err1, 'rename error set as context')
        t.match(vol.toJSON(), {
          '/src/foo': 'bar'
        }, 'temp file removed')
        t.done()
      })
  })
})
