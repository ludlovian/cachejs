'use strict'

const tap = require('tap')
const sinon = require('sinon')

tap.test('removeFile', async t => {
  const removeFile = require('../lib/removefile')
  const { vol, fs } = require('memfs')
  removeFile.fs = fs

  t.beforeEach(async () => {
    vol.reset()
    vol.fromJSON({ '/foo/bar/baz': 'quux' })
  })

  t.test('removing a file', async t => {
    await removeFile('/foo/bar/baz', { top: '/foo/bar', fs })

    t.match(vol.toJSON(), {
      '/foo/bar': null
    }, 'file removed')
  })

  t.test('removing a file and parent directory', async t => {
    await removeFile('/foo/bar/baz', { top: '/foo' })

    t.match(vol.toJSON(), {
      '/foo': null
    }, 'file and parent dir removed')
  })

  t.test('removing a file whilst a sibling exists', async t => {
    vol.writeFileSync('/foo/bar/bom', 'xuuq')
    await removeFile('/foo/bar/baz')

    t.match(vol.toJSON(), {
      '/foo/bar/bom': 'xuuq'
    }, 'file removed, but not the parent')
  })

  t.test('when the unlink fails', t => {
    t.tearDown(async () => sinon.restore())
    const err = new Error('foobar')
    sinon.replace(fs, 'unlink', sinon.fake.yieldsAsync(err))

    removeFile('/foo/bar/baz').catch(e => {
      t.strictSame(e, err, 'error thrown')
      t.match(vol.toJSON(), {
        '/foo/bar/baz': 'quux'
      }, 'file not removed')
      t.done()
    })
  })

  t.test('when the rmdir fails', t => {
    t.tearDown(async () => sinon.restore())
    const err = new Error('foobar')
    sinon.replace(fs, 'rmdir', sinon.fake.yieldsAsync(err))

    removeFile('/foo/bar/baz').catch(e => {
      t.strictSame(e, err, 'error thrown')
      t.match(vol.toJSON(), {
        '/foo/bar/baz': null
      }, 'file removed')
      t.done()
    })
  })
})
