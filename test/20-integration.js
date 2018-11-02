'use strict'

const tap = require('tap')
const { promisify } = require('util')
const wrapFs = require('wrap-fs')
const pfs = wrapFs.promisify(require('fs'))

const SOURCE = './test/source'
const CACHE = './test/cache'

tap.test('cachejs', async t => {
  const { start, stop, nudge, onIdle } = require('../lib/cachejs')

  await setup()
  t.tearDown(cleanup)

  const lines = patchLog('info')
  const errors = patchLog('warn')

  t.test('start and stop', async t => {
    lines.splice(0)
    const cfs = start()
    t.type(cfs, require('fs').constructor, 'it is an `fs`')
    nudge()
    await onIdle()
    await stop()
    t.match(lines, [
      /^cachejs v/,
      /^source /,
      /^cache /,
      /^mount /,
      /^cleaning/,
      /^started/,
      /^cleaning/,
      /^stopped/
    ], 'output ok')
    t.strictSame(errors, [], 'no errors')
  })

  t.test('reading and caching', async t => {
    await pfs.mkdir(SOURCE + '/dir')
    await pfs.writeFile(SOURCE + '/dir/metadata.yaml', 'metadata')
    await pfs.writeFile(SOURCE + '/dir/track1.flac', 'data1')
    await pfs.writeFile(SOURCE + '/dir/track2.flac', 'data2')
    await pfs.writeFile(SOURCE + '/dir/track3.flac', 'data3')
    const cfs = wrapFs.promisify(start())
    t.tearDown(stop)

    t.test('reading an uncacheable file', async t => {
      lines.splice(0)
      const res = await readFile(cfs, '/dir/metadata.yaml')
      await onIdle()
      t.strictSame(res, 'metadata', 'read ok')
      t.match(lines, [
        /^READ +\/dir\/metadata\.yaml/
      ], 'lines ok')
      t.strictSame(errors, [], 'no errors')
    })

    t.test('reading a non-existent file', t => {
      lines.splice(0)
      cfs.open('/foo/bar', 'r')
        .catch(e => {
          t.type(e, Error, 'error thrown')
          t.done()
        })
    })

    t.test('read part of an uncached file', async t => {
      lines.splice(0)
      const res = await readFile(cfs, '/dir/track1.flac', 2)
      await onIdle()
      t.strictSame(res, 'da', 'read ok')
      t.match(lines, [
        /^MISS +\/dir\/track1\.flac/
      ], 'lines ok')
      t.strictSame(errors, [], 'no errors')
    })

    t.test('read enough of a file to cause caching', async t => {
      lines.splice(0)
      const res = await readFile(cfs, '/dir/track1.flac')
      await onIdle()
      t.strictSame(res, 'data1', 'read ok')
      t.match(lines, [
        /MISS +\/dir\/track1\.flac/,
        /CACHE +\/dir\/track1\.flac/,
        /CACHE +\/dir\/track2\.flac/
      ], 'lines ok')
      t.strictSame(errors, [], 'no errors')
      const files = await pfs.readdir(CACHE + '/dir')
      t.strictSame(files.sort(),
        [ 'track1.flac', 'track2.flac' ],
        'files cached')
    })

    t.test('open a file for long enough to cause caching', async t => {
      lines.splice(0)
      const delay = promisify(setTimeout)
      const fd = await cfs.open('/dir/track1.flac', 'r')
      await delay(50)
      await cfs.close(fd)
      await onIdle()
      t.match(lines, [
        /HIT +\/dir\/track1\.flac/
      ], 'lines ok')
      t.strictSame(errors, [], 'no errors')
    })

    t.test('read a cached file', async t => {
      lines.splice(0)
      const res = await readFile(cfs, '/dir/track1.flac')
      await onIdle()
      t.strictSame(res, 'data1', 'read ok')
      t.match(lines, [
        /HIT +\/dir\/track1\.flac/
      ], 'lines ok')
      t.strictSame(errors, [], 'no errors')
    })

    t.test('cleaning the cache', async t => {
      lines.splice(0)
      const earlier = (Date.now() / 1000) - 600 // unix time
      await pfs.utimes(CACHE + '/dir/track1.flac', earlier, earlier)
      await pfs.utimes(CACHE + '/dir/track2.flac', earlier, earlier)
      nudge()
      await onIdle()
      t.match(lines, [
        /^cleaning/,
        /^UNCACHE +\/dir\/track2\.flac/
      ], 'lines ok')
      const files = await pfs.readdir(CACHE + '/dir')
      t.strictSame(files, [ 'track1.flac' ], 'file uncached')
    })
  })

  t.test('errors', async t => {
    const earlier = Date.now() / 1000 - 600
    await pfs.copyFile(SOURCE + '/dir/track3.flac', CACHE + '/dir/track2.flac')
    await pfs.utimes(CACHE + '/dir/track2.flac', earlier, earlier)
    const err = new Error('oops')
    const sinon = require('sinon')
    const delay = promisify(setTimeout)

    const cfs = wrapFs.promisify(start())
    t.tearDown(stop)
    t.afterEach(async () => sinon.restore())

    t.test('watcher & cleaner error', async t => {
      // there is an initial clean queued after the start that
      // will also fail if we patch `stat`
      sinon.replace(require('fs'), 'stat', sinon.fake.yieldsAsync(err))
      lines.splice(0)
      errors.splice(0)
      const fd = await cfs.open('/dir/track1.flac', 'r')
      await delay(10) // long enough for the watcher to `stat`
      await cfs.close(fd)
      await onIdle()
      t.match(lines, [
        /^HIT/
      ], 'lines ok')
      t.match(errors, [
        /^ERROR whilst watching/,
        /^ERROR whilst cleaning/
      ], 'errors ok')
    })

    t.test('preloader error', async t => {
      sinon.replace(require('fs'), 'readdir', sinon.fake.yieldsAsync(err))
      lines.splice(0)
      errors.splice(0)
      await readFile(cfs, '/dir/track1.flac') // triggers preload
      await onIdle()
      t.same(lines.length, 1, 'only on line')
      t.match(lines, [ /^HIT/ ], 'lines ok')
      t.same(errors.length, 1, '1 error')
      t.match(errors, [ /^ERROR whilst preloading/ ], 'errors ok')
    })

    t.test('preloader error', async t => {
      sinon.replace(require('fs'), 'unlink', sinon.fake.yieldsAsync(err))
      lines.splice(0)
      errors.splice(0)
      nudge()
      await onIdle()
      t.same(lines.length, 2, '2 lines')
      t.match(lines, [
        'cleaning cache',
        /^UNCACHE/
      ], 'lines ok')
      t.same(errors.length, 1, '1 error')
      t.match(errors, [ /^ERROR whilst removing/ ], 'errors ok')
    })
  })
})

async function setup () {
  const rimraf = promisify(require('rimraf'))
  const mkdirp = promisify(require('mkdirp'))
  for (const dir of [ SOURCE, CACHE ]) {
    await rimraf(dir)
    await mkdirp(dir)
  }
}

function patchLog (type) {
  const log = require('../lib/log')
  const { format } = require('util')
  const arr = []
  log[type] = (...args) => arr.push(format(...args))
  return arr
}

async function cleanup () {
  const rimraf = promisify(require('rimraf'))
  for (const dir of [ SOURCE, CACHE ]) {
    await rimraf(dir)
  }
}

async function readFile (fs, path, n = -1) {
  const stats = await fs.stat(path)
  if (n < 0) n = stats.size
  const fd = await fs.open(path, 'r')
  const buf = Buffer.alloc(n)
  await fs.read(fd, buf, 0, n, 0)
  await fs.close(fd)
  return buf.toString('utf8')
}
