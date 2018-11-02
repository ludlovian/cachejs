'use strict'

// cache cleaner
//
//    cleaner.clean(opts) -> Promise<[path]>
//
//    options:
//      cleanAfter:     secs after last access to clean
//      ignoreFilter:   regex to exclude from cleaning
//      cache:          cache root
//      fs:             fs to use
//
//    causes cleaner to emit:
//      clean, path     path to be removed
//      error, err      error in the readdir or stat

const EventEmitter = require('events')
const promisify = require('util').promisify
const { join } = require('path')

const config = require('config')

const debug = require('debug')('cachejs:cleaner')

class Cleaner extends EventEmitter {
  constructor () {
    super()
    this.defaultOptions = {
      fs: require('fs'),
      ignoreFilter: new RegExp(config.get('cleanup.ignoreFilter')),
      cleanAfter: config.get('cleanup.cleanAfter'),
      cache: config.get('dirs.cache')
    }
  }

  clean (opts = {}) {
    debug('clean')
    opts = { ...this.defaultOptions, ...opts }
    return this.scandir(opts.cache, opts)
      .then(paths => {
        debug('to be cleaned: %o', paths)
        return paths
      }, err => {
        this.emit('error', err)
        return [] // return empty list on failure
      })
  }

  async scandir (path, opts) {
    const { fs, cleanAfter, ignoreFilter } = opts
    debug('cleanAfter %d seconds', cleanAfter)
    const readdir = promisify(fs.readdir)
    const stat = promisify(fs.stat)
    const latestAtime = Date.now() - (cleanAfter * 1000)

    const names = await readdir(path)
    const stats = await Promise.all(
      names
        .map(async name => {
          const stats = await stat(join(path, name))
          return { name, path: join(path, name), stats }
        })
    )
    const files = stats.filter(({ stats }) => stats.isFile())
    const dirs = stats.filter(({ stats }) => stats.isDirectory())

    // files to be cleaned are those that don't match the ignore
    // filter, and have not been accessed for a while
    const toBeCleaned = files
      .filter(({ name }) => !ignoreFilter.test(name))
      .filter(({ stats }) => stats.atimeMs < latestAtime)
      .map(({ path }) => path)

    // emit any files
    toBeCleaned.forEach(path => this.emit('clean', path))

    // now we go through any subdirs in sequence
    for (let subdir of dirs) {
      const subfiles = await this.scandir(subdir.path, opts)
      toBeCleaned.push(...subfiles)
    }
    return toBeCleaned
  }
}

module.exports = new Cleaner()
