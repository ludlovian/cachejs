'use strict'

// examines an emitting fs to determine when a file meets the criteria
// to be preloaded (or at least checking to see if it needs to be)
//
//    watchFiles = require('watcher')
//    watcher = watchFiles(fsi, emitter, { openDelay, readPercentage, filter })
//    watcher
//      .on('preload', {reason, path} => ...)
//      .on('error', msg => ...)
//

const EventEmitter = require('events')
const config = require('config')

const trigger = require('trigger')

const assert = require('assert')
const debug = require('debug')('cachejs:watcher')

class FileWatcher extends EventEmitter {
  constructor (fs, opts = {}) {
    assert(typeof fs.stat === 'function', 'fs must support stat')
    assert(fs.emitter instanceof EventEmitter, 'fs must have an emitter')

    const defaultOptions = {
      openDelay: config.get('preload.openDelay'),
      readPercentage: config.get('preload.readPercentage'),
      filter: new RegExp(config.get('preload.filter'))
    }
    opts = { ...defaultOptions, ...opts }

    assert(typeof opts.openDelay === 'number', 'must supply openDelay')
    assert(typeof opts.readPercentage === 'number', 'must supply readPercentage')
    assert(opts.filter instanceof RegExp, 'must supply filter')

    super()
    this.fs = fs
    this.openFiles = new Map()
    this.recentStats = new Map()
    this.recentCount = 10
    this.openDelay = opts.openDelay
    this.readPercentage = opts.readPercentage
    this.filter = opts.filter

    fs.emitter.on('open', this.onOpen.bind(this))
      .on('close', this.onClose.bind(this))
      .on('read', this.onRead.bind(this))
      .on('stat', this.onStat.bind(this))

    debug('created: %o', this)
  }

  onOpen (item) {
    debug('onOpen: %o', item)
    if (item.err) return
    const path = item.args[0]
    if (!this.filter.test(path)) return
    const fd = item.result
    const rec = {
      path,
      trigger: trigger(),
      size: null,
      read: 0
    }
    this.openFiles.set(fd, rec)
    rec.trigger.fireAfter(this.openDelay, 'time')
    rec.trigger.then(reason => {
      debug('preload %s trigger %s', reason, rec.path)
      this.emit('preload', { reason, path: rec.path })
    })
    if (this.recentStats.has(path)) {
      rec.size = this.recentStats.get(path).size
    } else {
      this.fs.stat(path, (err, stats) => {
        if (err) return this.emit('error', err)
        rec.size = stats.size
      })
    }
  }

  onClose (item) {
    debug('onClose: %o', item)
    if (item.err) return
    const fd = item.args[0]
    const rec = this.openFiles.get(fd)
    if (!rec) return
    rec.trigger.cancel()
    this.openFiles.delete(fd)
  }

  onRead (item) {
    if (item.err) return
    const fd = item.args[0]
    const length = item.args[3]
    const rec = this.openFiles.get(fd)
    if (!rec) return
    rec.read += length
    if (typeof rec.size === 'number') {
      const threshold = this.readPercentage * rec.size / 100
      if (rec.read > threshold) rec.trigger.fire('read')
    }
  }

  onStat (item) {
    if (item.err) return
    const key = item.args[0]
    const value = item.result
    const lru = this.recentStats
    const lruMax = this.recentCount

    if (lru.has(key)) {
      lru.delete(key)
      lru.set(key, value)
    } else {
      lru.set(key, value)
      if (lru.size > lruMax) {
        lru.delete(lru.keys().next().value)
      }
    }
  }
}

function watchFiles (fs, opts) { return new FileWatcher(fs, opts) }

module.exports = watchFiles
