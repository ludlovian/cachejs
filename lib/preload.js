'use strict'

// pre load logic
//
// called when a caceh preload has been suggested by the watcher
//
// It sees if the file (and any siblings) have been cached, and
// queues caches for any that haven't
//
//  preloader.preload(path opts) -> Promise<>
//
//  options:
//    siblings:   how many sibs to cache (excluding this path)
//    filter:     regex for the name to include cacheable files
//    source:     source root
//    cache:      cache root
//    fs:         fs to use
//
//  causes preloader to emit:
//    cachefile, path   path under root which needs to be cached
//    error, err        error in the readdir or stat
//

const EventEmitter = require('events')
const promisify = require('util').promisify
const { basename, dirname, join } = require('path')

const config = require('config')

const debug = require('debug')('cachejs:preload')

class Preloader extends EventEmitter {
  constructor () {
    super()
    this.defaultOptions = {
      fs: require('fs'),
      siblings: config.get('preload.siblings'),
      filter: new RegExp(config.get('preload.filter')),
      source: config.get('dirs.source'),
      cache: config.get('dirs.cache')
    }
  }

  async preload (path, opts = {}) {
    debug('preload %s', path)
    opts = { ...this.defaultOptions, ...opts }
    try {
      const sibs = await findSiblings(path, opts)
      const uncached = await findUncached(sibs, opts)
      debug('emitting uncached=%o', uncached)
      uncached.forEach(path => this.emit('cachefile', path))
      debug('finished emitting uncached=%o', uncached)
      return uncached
    } catch (err) {
      debug('err:%o', err)
      this.emit('error', err)
    }
  }
}

async function findSiblings (path, { fs, siblings, source, filter }) {
  debug('finding sibs of %s', path)
  const dir = dirname(path)
  const base = basename(path)
  const readdir = promisify(fs.readdir)

  let names = await readdir(join(source, dir))
  names = names.sort().filter(name => filter.test(name))
  const idx = names.indexOf(base)
  let sibs = []
  if (idx >= 0) {
    sibs = names
      .slice(idx, idx + siblings + 1)
      .map(name => join(dir, name))
  }
  debug('sibs = %o', sibs)
  return sibs
}

async function findUncached (files, opts) {
  debug('findUncached: %o', files)
  const paths = await Promise.all(files.map(file => testIfNotCached(file, opts)))
  return paths.filter(path => !!path)
}

async function testIfNotCached (path, { fs, cache }) {
  try {
    const stat = promisify(fs.stat)
    await stat(join(cache, path))
    return null // it works, so it is cached
  } catch (err) {
    // it is not cached
    if (err.code === 'ENOENT') return path
    throw err
  }
}

module.exports = Preloader
