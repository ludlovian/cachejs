'use strict'

const tap = require('tap')
const sinon = require('sinon')

tap.test('preload', async t => {
  const Preloader = require('../lib/preload')
  const preloader = new Preloader()
  const { fs, vol } = require('memfs')
  const options = {
    fs,
    filter: /\.flac$/,
    siblings: 3,
    source: '/source',
    cache: '/cache'
  }
  const events = []
  const errors = []
  preloader.on('cachefile', events.push.bind(events))
    .on('error', errors.push.bind(errors))

  t.afterEach(async () => {
    events.splice(0)
    errors.splice(0)
  })

  t.test('when nothing is cached', async t => {
    vol.reset()
    vol.fromJSON({
      '/source/bar1.flac': 'data',
      '/source/bar2.flac': 'data',
      '/source/bar3.flac': 'data',
      '/source/bar4.flac': 'data',
      '/source/bar5.flac': 'data',
      '/source/bar6.flac': 'data',
      '/cache': null
    })

    const res = await preloader.preload('/bar2.flac', options)

    t.strictSame(events.sort(), [
      '/bar2.flac',
      '/bar3.flac',
      '/bar4.flac',
      '/bar5.flac'
    ], 'cache events emitted')
    t.strictSame(events, res, 'emitted events returned')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('when some are cached', async t => {
    vol.reset()
    vol.fromJSON({
      '/source/bar1.flac': 'data',
      '/source/bar2.flac': 'data',
      '/source/bar3.flac': 'data',
      '/source/bar4.flac': 'data',
      '/source/bar5.flac': 'data',
      '/source/bar6.flac': 'data',
      '/cache/bar2.flac': 'data',
      '/cache/bar4.flac': 'data',
      '/cache/bar6.flac': 'data'
    })

    const res = await preloader.preload('/bar2.flac', options)

    t.strictSame(events.sort(), [
      '/bar3.flac',
      '/bar5.flac'
    ], 'cache events emitted')
    t.strictSame(events, res, 'emitted events returned')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('when some don\'t match filter', async t => {
    vol.reset()
    vol.fromJSON({
      '/source/bar1.flac': 'data',
      '/source/bar2.flac': 'data',
      '/source/bar3.flax': 'data',
      '/source/bar4.flac': 'data',
      '/source/bar5.flac': 'data',
      '/source/bar6.flac': 'data',
      '/source/bar7.flac': 'data',
      '/cache/bar2.flac': 'data',
      '/cache/bar4.flac': 'data',
      '/cache/bar6.flac': 'data'
    })

    const res = await preloader.preload('/bar2.flac', options)

    t.strictSame(events.sort(), [
      '/bar5.flac'
    ], 'cache events emitted')
    t.strictSame(events, res, 'emitted events returned')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('when the file no longer exists', async t => {
    vol.reset()
    vol.fromJSON({
      '/source': null,
      '/cache': null
    })

    await preloader.preload('/bar2.flac', options)

    t.strictSame(events, [], 'no events')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('when readdir fails', async t => {
    t.tearDown(async () => sinon.restore())
    const err = new Error('oops')
    sinon.replace(require('fs'), 'readdir', sinon.fake.yieldsAsync(err))
    vol.reset()

    await preloader.preload('/foo')

    t.strictSame(events, [], 'no events')
    t.strictSame(errors, [ err ], 'error emitted')
  })

  t.test('when stat fails', async t => {
    t.tearDown(async () => sinon.restore())
    const err = new Error('oops')
    sinon.replace(fs, 'stat', sinon.fake.yieldsAsync(err))
    vol.reset()
    vol.fromJSON({
      '/source/foo1.flac': 'data'
    })

    await preloader.preload('/foo1.flac', options)

    t.strictSame(events, [], 'no events')
    t.strictSame(errors, [ err ], 'error emitted')
  })
})
