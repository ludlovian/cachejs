'use strict'

// cachejs
//
// creates filesystem which is a union of a cache and underlying file
// source
//
// the files are cached (copied from source to cache) if they are used
// sufficiently
//
//
//                            |
//                      emitting union -> watched for preload
//                            |
//             +-------------union-----------+
//            /                               \
//     emitting source -> MISS          emitting cache -> HIT
//          |            & READ                |
//     pruned source                      pruned cache
//          |                                  |
//      source-dir    --- cache file --->   cache dir  <- cleaner
//                    <--- uncache file --
//
//  In addition, the cache dir is regularly assessed to see if any cache
//  files are old and need cleaning
//

const fs = require('fs')
const { join, relative } = require('path')
const config = require('config')
const wrapFs = require('wrap-fs')

const watchFiles = require('./watcher')
const Preloader = require('./preload')
const worker = require('./worker')
const cleaner = require('./cleaner')
const copyFile = require('./copyfile')
const removeFile = require('./removefile')

const debug = require('debug')('cachejs:cachejs')

var cleanerTimeout = null

function start () {
  report.heading()
  const ufs = getCombinedFs()
  watchForPreloads(ufs)
  worker.push('cache clean', cleanCache)
  report.started()
  return ufs
}

async function stop () {
  await worker.stop()
  stopCleaner()
  report.stopped()
}

async function nudge () {
  stopCleaner()
  worker.push('cache clean', cleanCache)
}

async function cleanCache () {
  report.cleaningCache()
  stopCleaner()

  const cacheRoot = config.get('dirs.cache')
  cleaner.on('error', err => report.cleanerError(err))
  const filesToRemove = await cleaner.clean()

  for (let file of filesToRemove) {
    report.uncacheFile('/' + relative(cacheRoot, file))
    await removeFile(file, { top: cacheRoot })
      .catch(err => report.removeFileError(err, file))
  }

  startCleaner()
}

function startCleaner () {
  const interval = config.get('cleanup.cleanFrequency') * 1000
  stopCleaner()
  cleanerTimeout = setTimeout(nudge, interval)
}

function stopCleaner () {
  if (cleanerTimeout) {
    clearTimeout(cleanerTimeout)
    cleanerTimeout = null
  }
}

function watchForPreloads (ufs) {
  const preloader = new Preloader()
  const watcher = watchFiles(ufs)
  watcher
    .on('preload', ({ reason, path }) => {
      report.preload(reason, path)
      worker.push(`examine ${path}`, () => preloader.preload(path))
    })
    .on('error', err => report.watcherError(err))

  preloader
    .on('cachefile', path =>
      worker.push(`cache ${path}`, async () => {
        debug('reporting cachefile: %s', path)
        report.cacheFile(path)
        await cacheFile(path)
      })
    )
    .on('error', err => report.preloaderError(err))
}

function getCombinedFs () {
  const sfs = getSourceFs()
  const cfs = getCacheFs()
  const ufs = wrapFs.union(cfs, sfs)

  return wrapFs.emit(ufs, [ 'open', 'close', 'read', 'stat' ])
}

function getSourceFs () {
  const sourceDir = config.get('dirs.source')
  const filter = new RegExp(config.get('preload.filter'))
  const prunedFs = wrapFs.prune(fs, sourceDir)
  const sfs = wrapFs.emit(prunedFs, 'open')

  sfs.emitter.on('open', item => {
    if (item.err) return // no logging on failed open
    const path = item.args[0]
    if (filter.test(path)) report.cacheMiss(path)
    else report.uncachedRead(path)
  })

  return sfs
}

function getCacheFs () {
  const cacheDir = config.get('dirs.cache')
  const prunedFs = wrapFs.prune(fs, cacheDir)
  const cfs = wrapFs.emit(prunedFs, 'open')

  cfs.emitter.on('open', item => {
    if (item.err) return // no logging on failed open
    const path = item.args[0]
    report.cacheHit(path)
  })

  return cfs
}

async function cacheFile (path) {
  const sourceDir = config.get('dirs.source')
  const cacheDir = config.get('dirs.cache')
  await copyFile(join(sourceDir, path), join(cacheDir, path))
}

// all log reporting logic is in one place
const report = {
  log: require('./log'),

  heading () {
    const version = require('../package.json').version
    this.log.info('cachejs v%s', version)
    this.log.info('source : %s', config.get('dirs.source'))
    this.log.info('cache  : %s', config.get('dirs.cache'))
    this.log.info('mount  : %s', config.get('dirs.mount'))
  },

  started () {
    this.log.info('started')
  },

  stopped () {
    this.log.info('stopped')
  },

  cleaningCache () {
    this.log.info('cleaning cache')
  },

  cleanerError (err) {
    this.log.warn('ERROR whilst cleaning: %s', err)
  },

  removeFileError (err, path) {
    this.log.warn('ERROR whilst removing \'%s\': %s', path, err)
  },

  watcherError (err) {
    this.log.warn('ERROR whilst watching: %s', err)
  },

  preloaderError (err) {
    this.log.warn('ERROR whilst preloading: %s', err)
  },

  cacheFile (path) {
    this.log.info('CACHE   %s', path)
  },

  uncacheFile (path) {
    this.log.info('UNCACHE %s', path)
  },

  cacheHit (path) {
    this.log.info('HIT     %s', path)
  },

  cacheMiss (path) {
    this.log.info('MISS    %s', path)
  },

  uncachedRead (path) {
    this.log.info('READ    %s', path)
  },

  preload (reason, path) {
    this.log.debug('%s %s',
      (reason === 'time' ? 'REQ-TIM' : 'REQ-DAT'), path)
  }
}

module.exports = {
  start,
  stop,
  nudge,
  onIdle: worker.onIdle
}
