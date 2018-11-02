'use strict'

const tap = require('tap')
const promisify = require('util').promisify
const EventEmitter = require('events')
const delay = promisify(setTimeout)

tap.test('watcher', async t => {
  const watchFiles = require('../lib/watcher')
  const readPercentage = 50
  const openDelay = 20
  const path = '/foo.flac'
  const filter = /\.flac$/
  const fd = 17
  const opts = { readPercentage, openDelay, filter }

  t.test('make watcher', async t => {
    const emitter = new EventEmitter()
    const fs = { emitter, stat () {} }
    const watcher = watchFiles(fs)
    t.type(watcher, EventEmitter, 'watcher is an event emitter')
  })

  t.test('emitting preload events', async t => {
    const emitter = new EventEmitter()
    const fs = {
      emitter,
      stat (path, cb) {
        process.nextTick(() => cb(null, { size: 1000 }))
      }
    }
    const watcher = watchFiles(fs, opts)
    const events = []
    watcher.on('preload', events.push.bind(events))
    const errors = []
    watcher.on('error', errors.push.bind(errors))

    t.afterEach(async () => {
      events.splice(0)
      errors.splice(0)
    })

    t.test('open & close without reading', async t => {
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(10)
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('stat before open', async t => {
      emitter.emit('stat', { args: [ path ], result: { size: 1000 } })
      emitter.emit('open', { args: [ path ], result: fd })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('stat twice before open', async t => {
      emitter.emit('stat', { args: [ path ], result: { size: 1000 } })
      emitter.emit('stat', { args: [ path ], result: { size: 1000 } })
      emitter.emit('open', { args: [ path ], result: fd })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('fill stat cache', async t => {
      for (let i = 0; i < 20; i++) {
        emitter.emit('stat', { args: [ path + i ], result: { size: i * 1000 } })
      }
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(5)
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('open & wait more than threshold', async t => {
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(30)
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [
        { reason: 'time', path: '/foo' }
      ], 'time-based preload event fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('open & read more than threshold', async t => {
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(10) // to allow the stat to work
      emitter.emit('read', { args: [ fd, 'buf', 'off', 550, 'pos' ] })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [
        { reason: 'read', path: '/foo' }
      ], 'read-based preload event fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('open & read less than threshold', async t => {
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(10) // to allow the stat to work
      emitter.emit('read', { args: [ fd, 'buf', 'off', 450, 'pos' ] })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('meet read and time criteria', async t => {
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(30) // to trigger the time based
      emitter.emit('read', { args: [ fd, 'buf', 'off', 550, 'pos' ] })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [
        { reason: 'time', path: '/foo' }
      ], 'only one preload event fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('not triggering on file that doesnt match filter', async t => {
      emitter.emit('open', { args: [ '/foo' ], result: fd })
      await delay(30) // to trigger time based
      emitter.emit('read', { args: [ fd, 'buf', 'off', 550, 'pos' ] })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('not triggering on invalid read', async t => {
      const err = new Error('oops')
      emitter.emit('stat', { args: [ path ], err })
      emitter.emit('open', { args: [ path ], err })
      await delay(30)
      emitter.emit('read', { err })
      await delay(5)
      emitter.emit('close', { err })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('reading before the stat completes', async t => {
      emitter.emit('open', { args: [ path ], result: fd })
      emitter.emit('read', { args: [ fd, 'buf', 'off', 550, 'pos' ] })
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.match(events, [], 'no events fired')
      t.match(errors, [], 'no errors fired')
    })

    t.test('when the requested stat fails', async t => {
      // overflow cache to force a read
      for (let i = 0; i < 20; i++) {
        emitter.emit('stat', { args: [ path + i ], result: { size: i * 1000 } })
      }
      const err = new Error('oops')
      fs.stat = (path, cb) => delay(1).then(() => cb(err))
      emitter.emit('open', { args: [ path ], result: fd })
      await delay(10)
      emitter.emit('close', { args: [ fd ] })
      await delay(5)
      t.strictSame(events, [], 'no events fired')
      t.strictSame(errors, [ err ], 'error fired')
    })
  })
})
