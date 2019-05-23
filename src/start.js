'use strict'

import getVfs from './vfs'
import Report from './report'
import { version } from '../package.json'

export default function start (sourceDir, cacheDir, mountDir, options) {
  Object.assign(options, {
    sourceDir,
    cacheDir,
    mountDir,
    version
  })

  const [vfs, cache] = getVfs(options)
  const report = new Report(options)
  report.attach(cache)

  start().catch(err => {
    console.error(err)
    process.exit(1)
  })

  async function start () {
    const { cleanAfter } = options
    if (cleanAfter) {
      setInterval(nudge, 1000 * cleanAfter).unref()
    }

    report.heading()
    await vfs.mount(mountDir)
    report.started()
    nudge()

    process.on('SIGINT', stop).on('SIGTERM', stop)
    process.on('SIGUSR1', nudge)
  }

  async function stop () {
    await vfs.unmount()
    report.stopped()
  }

  async function nudge () {
    const { cleanIgnore, cleanAfter } = options
    report.cleaning()
    await cache.clean(cleanIgnore, cleanAfter)
  }
}
