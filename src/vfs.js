'use strict'

import realFS from 'fs'
import FuseFS from 'fuse-fs'
import Cache from './cache'

/*
 * vfs
 *
 * Creates the FUSE-ready virtual filesystem, with all the hooks
 * ready for the cache
 *
 */

export default function getVfs (options) {
  const cache = new Cache(options)
  // istanbul ignore next
  options.fs = options.fs || realFS
  const { fuse, fs } = options
  const fuseOpts = ['ro'].concat(fuse || [])
  const ffs = new FuseFS(fs, { options: fuseOpts, force: true })

  ffs.before('readdir', onReaddir)
  ffs.before('getattr', 'open', redirectToCacheOrSource)
  ffs.after('open', onOpen)
  ffs.after('read', onRead)
  ffs.after('release', onClose)

  return [ffs, cache]

  async function onReaddir (ctx) {
    const [path] = ctx.args
    ctx.results = [null, await cache.readdir(path)]
  }

  async function redirectToCacheOrSource (ctx) {
    const [path] = ctx.args
    const { fullpath } = await cache.locate(path)
    ctx.args[0] = fullpath
  }

  async function onOpen (ctx) {
    const {
      origArgs: [path],
      results: [err, fd]
    } = ctx
    // istanbul ignore if
    if (err) return
    await cache.onOpen(fd, path)
  }

  function onRead ({ args: [fd], results: [bytes] }) {
    // istanbul ignore if
    if (bytes < 0) return
    cache.onRead(fd, bytes)
  }

  function onClose ({ args: [fd] }) {
    cache.onClose(fd)
  }
}

/*
import fs from 'fs'
import FuseFS from 'fuse-fs'
import { join } from 'path'

import options, { set as setOptions } from './options'

import { analyse } from './cache'
import * as report from './report'
import * as executor from './executor'
import * as cleaner from './cleaner'
import * as preloader from './preloader'

const debug = require('debug')('cachejs:start')

export default function cachejs (sourceDir, cacheDir, mountDir, _options) {
  setOptions({
    ..._options,
    sourceDir,
    cacheDir,
    mountDir
  })

  debug('options=%o', options)

  const vfs = getFuseFs(options)
  start().catch(err => {
    console.error(err)
    process.exit(1)
  })

  async function start () {
    debug('start')
    report.start()
    cleaner.start()

    report.heading()
    await vfs.mount(mountDir)
    report.started()

    process.on('SIGINT', stop).on('SIGTERM', stop)
    process.on('SIGUSR1', nudge)

    await executor.execute(cleaner.clean)
  }

  async function stop () {
    debug('stop')
    cleaner.stop()
    await executor.stop()
    await vfs.unmount()
    report.stopped()
  }

  async function nudge () {
    await executor.execute(cleaner.clean)
  }
}

// The main FuseFS. It reacts to the following
//
// readdir [before]
//  - redirect to perform the readdir against the source directory
//
// getattr [before]
// - locate the file in the cache or source, and redirect to the
//   first one you find
//
// open [before]
// - locate the file in the cache or source, and redirect to the
//   first one you find
//
// open [after]
// - report HIT/MISS/READ
// - if it matches, then inform the preloader about the open
//
// release [after]
// - inform the preloader about the close
//
// read [after]
// - inform the preloader about the read

function getFuseFs () {
  const { fuse } = options
  const fuseOpts = ['ro'].concat(fuse || [])
  const vfs = new FuseFS(fs, { options: fuseOpts, force: true })

  vfs.beforeCall('readdir', redirectToSource)
  vfs.beforeCall('getattr', redirectToCacheOrSource)
  vfs.beforeCall('open', redirectToCacheOrSource)
  vfs.afterCall('open', onOpen)
  vfs.afterCall('read', onRead)
  vfs.afterCall('release', onClose)
  return vfs
}

function redirectToSource ({ args }) {
  const { sourceDir } = options
  const [path] = args
  args[0] = join(sourceDir, path)
  debug('redirect %s -> %s', path, args[0])
}

async function redirectToCacheOrSource ({ args }) {
  const [path] = args
  const { fullpath } = await analyse(path)
  args[0] = fullpath
  debug('redirect %s -> %s', path, args[0])
}

async function onOpen ({ origArgs: [path], results: [err, fd] }) {
  if (err) return
  debug('opened %s as #%d', path, fd)
  const { cached, cacheable } = await analyse(path)
  if (cacheable) {
    preloader.onOpen(fd, path)
    if (cached) report.cacheHit(path)
    else report.cacheMiss(path)
  } else {
    report.uncachedRead(path)
  }
}

async function onRead ({ args: [fd], results: [bytesRead] }) {
  if (bytesRead < 0) return
  debug('read %d from #%d', bytesRead, fd)
  preloader.onRead(fd, bytesRead)
}

async function onClose ({ args: [fd] }) {
  debug('close #%d', fd)
  preloader.onClose(fd)
}
*/
