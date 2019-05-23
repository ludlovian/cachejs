'use strict'

import realFs from 'fs'
import { promisify } from 'util'
import { basename, dirname, join, relative } from 'path'
import PLock from 'plock'
import TimedTrigger from 'timed-trigger'
import Emitter from 'emitter'
import filescan from 'filescan'

/*
 * Cache
 *
 * Represents the pairing of source/cache, and the (un)caching of files
 *
 * Construction
 *    In addition to program options, it also takes
 *    - fs: the fs-like to use
 *    - mruSize: size of the MRU cache
 *
 * Public API
 *
 *  - readdir(dir) - reads source/cache
 *  - locate(path) - returns { cached, cacheable, stats, fullpath }
 *  - onOpen(fd, path) - inform about an open
 *  - onRead(fd, bytes) - inform about a read
 *  - onClose(fd) - inform about a close
 *  - clean(filter, age) - clean the cache
 *
 * Events
 *
 *  - request([reason, path])
 *  - cache(path)
 *  - uncache(path)
 *  - hit(path)
 *  - miss(path)
 *  - read(path) (for non-cacheable)
 *  - error(err)
 */

const priv = Symbol('priv')

export default class Cache extends Emitter {
  constructor (options) {
    super()
    Object.defineProperty(this, priv, { value: getPrivate(options) })
  }

  async readdir (path) {
    const { sourceDir, readdir } = this[priv]
    return readdir(join(sourceDir, path))
  }

  async locate (path) {
    const {
      mruFiles,
      mruSize,
      preloadFilter,
      lstat,
      sourceDir,
      cacheDir
    } = this[priv]

    let rec = mruFiles.get(path)
    if (rec) {
      mruFiles.delete(path)
      mruFiles.set(path, rec)
      return rec
    }

    rec = {
      path,
      fullpath: join(cacheDir, path),
      cached: true,
      cacheable: preloadFilter.test(basename(path))
    }

    try {
      rec.stats = await lstat(rec.fullpath)
    } catch (err) {
      // istanbul ignore if
      if (err.code !== 'ENOENT') throw err
      rec.fullpath = join(sourceDir, path)
      rec.cached = false
      rec.stats = await lstat(rec.fullpath)
    }

    mruFiles.set(path, rec)
    if (mruFiles.size > mruSize) {
      mruFiles.delete(mruFiles.keys().next().value)
    }
    return rec
  }

  async onOpen (fd, path) {
    const { openFiles, preloadOpen, preloadFilter } = this[priv]

    if (!preloadFilter.test(basename(path))) {
      // uncacheable file
      this.emit('read', path)
      return
    }

    const { cached } = await this.locate(path)
    this.emit(cached ? 'hit' : 'miss', path)

    const rec = {
      path,
      trigger: new TimedTrigger(),
      read: 0
    }
    openFiles.set(fd, rec)

    rec.trigger.fireAfter(preloadOpen, 'time')
    rec.trigger.then(reason =>
      execute(this, () => requestCache(this, reason, path))
    )
    execute(this, () => getFileSize(this, rec))
  }

  onRead (fd, bytes) {
    const { openFiles, preloadRead } = this[priv]
    const rec = openFiles.get(fd)
    if (!rec) return
    rec.read += bytes
    if (typeof rec.size === 'number') {
      const threshold = (preloadRead * rec.size) / 100
      if (rec.read > threshold) rec.trigger.fire('read')
    }
  }

  onClose (fd) {
    const { openFiles } = this[priv]
    const rec = openFiles.get(fd)
    if (!rec) return
    rec.trigger.clear()
    openFiles.delete(fd)
  }

  clean (cleanIgnore, cleanAfter) {
    cleanIgnore = ensureRegex(cleanIgnore)
    const { cacheDir, filescan, mruFiles } = this[priv]
    return execute(this, async () => {
      for await (let { path, stats } of filescan(cacheDir)) {
        if (!stats.isFile()) continue
        if (cleanIgnore.test(basename(path))) continue
        const then = Date.now() - cleanAfter * 1000
        if (stats.atimeMs < then) {
          path = '/' + relative(cacheDir, path)
          await uncacheFile(this, path)
          this.emit('uncache', path)
        }
      }
      mruFiles.clear()
    })
  }
}

function getPrivate ({
  sourceDir,
  cacheDir,
  preloadSiblings,
  preloadFilter,
  preloadRead,
  preloadOpen,
  mruSize = 10,
  fs = realFs
}) {
  return {
    sourceDir,
    cacheDir,
    preloadSiblings,
    preloadFilter: ensureRegex(preloadFilter),
    preloadRead,
    preloadOpen,
    mruSize,
    mruFiles: new Map(),
    openFiles: new Map(),
    lock: new PLock(),
    lstat: promisify(fs.lstat),
    readdir: promisify(fs.readdir),
    copyFile: promisify(fs.copyFile),
    mkdir: promisify(fs.mkdir),
    rmdir: promisify(fs.rmdir),
    unlink: promisify(fs.unlink),
    utimes: promisify(fs.utimes),
    filescan: path => filescan({ path, fs })
  }
}

function ensureRegex (rgx) {
  return rgx instanceof RegExp ? rgx : new RegExp(rgx)
}

async function execute (cache, fn) {
  try {
    await cache[priv].lock.exec(fn)
  } catch (err) {
    // istanbul ignore next
    cache.emit('error', err)
  }
}

async function getFileSize (cache, rec) {
  const { stats } = await cache.locate(rec.path)
  rec.size = stats.size
}

async function requestCache (cache, reason, path) {
  cache.emit('request', [reason, path])
  const files = await getSiblings(cache, path)
  for (const sib of files) {
    if (await cacheFile(cache, sib)) {
      cache.emit('cache', sib)
    }
  }
}

async function getSiblings (cache, path) {
  const { sourceDir, readdir, preloadSiblings, preloadFilter } = cache[priv]

  let files = await readdir(dirname(join(sourceDir, path)))
  files = files.sort().filter(f => preloadFilter.test(f))
  const ix = files.indexOf(basename(path))
  return files
    .slice(ix, ix + preloadSiblings + 1)
    .map(f => join(dirname(path), f))
}

async function cacheFile (cache, path) {
  const { sourceDir, cacheDir, lstat, utimes, copyFile, mruFiles } = cache[priv]

  const { cached } = await cache.locate(path)
  if (cached) return false

  const sourceFile = join(sourceDir, path)
  const destFile = join(cacheDir, path)

  await mkdirs(cache, dirname(destFile))
  await copyFile(sourceFile, destFile)
  const stats = await lstat(sourceFile)
  await utimes(destFile, stats.atime, stats.mtime)
  mruFiles.delete(path)
  return true
}

async function mkdirs (cache, dir) {
  const { mkdir } = cache[priv]
  try {
    await mkdir(dir)
  } catch (err) {
    if (err.code === 'EEXIST') return
    // istanbul ignore if
    if (err.code !== 'ENOENT') throw err
    await mkdirs(cache, dirname(dir)) // make the parent dir
    return mkdirs(cache, dir) // try again
  }
}

async function uncacheFile (cache, path) {
  const { sourceDir, cacheDir, unlink } = cache[priv]

  const fullpath = join(cacheDir, path)
  // adjust the cache in case some about to read
  const rec = await cache.locate(path)
  rec.cached = false
  rec.fullpath = join(sourceDir, path)

  await unlink(fullpath)
  await rmdirs(cache, dirname(fullpath))
}

async function rmdirs (cache, dir) {
  const { cacheDir, rmdir } = cache[priv]
  if (dir === cacheDir) return
  try {
    await rmdir(dir)
    await rmdirs(cache, dirname(dir))
  } catch (err) {
    // istanbul ignore if
    if (err.code !== 'ENOTEMPTY') throw err
  }
}
