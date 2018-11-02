'use strict'

const config = require('config')
const cachejs = require('./cachejs')
const { mount, umount } = require('fuse-fs')

async function start () {
  const mountDir = config.get('dirs.mount')
  const opts = {
    force: true,
    options: config.get('fuseOptions')
  }
  const cacheFs = cachejs.start()
  await mount(cacheFs, mountDir, opts)

  async function stop () {
    await umount(mountDir)
    await cachejs.stop()
  }

  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  process.on('SIGHUP', cachejs.nudge)
}

start().catch(err => {
  console.err('Fatal error:', err)
  process.nextTick(() => process.exit(1))
})
