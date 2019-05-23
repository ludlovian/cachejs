'use strict'

import test from 'ava'

import Cache from '../src/cache'
import { MemFS } from 'mem-fs'

const options = {
  sourceDir: '/source',
  cacheDir: '/cache',
  preloadSiblings: 2,
  preloadOpen: 50,
  preloadRead: 50,
  preloadFilter: '^.*\\.flac$'
}

const DIR = '/foo/bar'

test.beforeEach(t => {
  const fs = new MemFS()
  makeFS(fs)
  t.context = { fs }
})

test('basic setup', async t => {
  t.pass()
})

test('cache with real fs', async t => {
  const c = new Cache({ ...options })
  // don't do anything with it, as its on the real filesystem
  t.true(c instanceof Cache)
})

test('readdir', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })
  const files = await c.readdir(DIR)
  t.deepEqual(files, [
    'file1.flac',
    'file2.claf',
    'file3.flac',
    'file4.flac',
    'file5.flac'
  ])
})

test('locate uncachable file', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })
  const res = await c.locate(DIR + '/file2.claf')
  t.is(res.cacheable, false)
  t.is(res.cached, false)
})

test('locate file twice', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })
  const res = await c.locate(DIR + '/file1.flac')
  t.is(res.cacheable, true)
  t.is(res.cached, false)
  await c.locate(DIR + '/file1.flac')
})

test('locate more files than fit in the cache', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs, mruSize: 2 })
  await c.locate(DIR + '/file1.flac')
  await c.locate(DIR + '/file2.claf')
  await c.locate(DIR + '/file3.flac')
  await c.locate(DIR + '/file4.flac')
  t.pass()
})

test('open uncacheable file', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })
  const calls = getCalls(c)
  const file = DIR + '/file2.claf'

  await c.onOpen(1, file)
  c.onRead(1, 5)
  await delay(20)
  c.onClose(1)

  t.deepEqual(calls, [['read', file]])
})

test('open uncached file', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })
  const calls = getCalls(c)
  const file = DIR + '/file1.flac'

  await c.onOpen(1, file)
  await delay(20)
  c.onClose(1)

  t.deepEqual(calls, [['miss', file]])
})

test('cache file due to time', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })
  const calls = getCalls(c)
  const file = DIR + '/file1.flac'

  await c.onOpen(1, file)
  await delay(100)
  c.onClose(1)

  t.deepEqual(calls, [
    ['miss', file],
    ['request', ['time', file]],
    ['cache', file],
    ['cache', DIR + '/file3.flac'],
    ['cache', DIR + '/file4.flac']
  ])

  t.true(fs.existsSync('/cache/foo/bar/file1.flac'))

  const rec = await c.locate(file)
  t.is(rec.cached, true)

  calls.splice(0)
  await c.onOpen(1, file)
  await delay(100)
  c.onClose(1)

  t.deepEqual(calls, [['hit', file], ['request', ['time', file]]])
})

test('cache file due to read', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, preloadOpen: 10000, fs })
  const calls = getCalls(c)
  const file = DIR + '/file1.flac'

  await c.onOpen(1, file)
  c.onRead(1, 2) // 20% of file
  await delay(20) // now dize should be in place
  c.onRead(1, 2) // 20% of file
  await delay(20) // now dize should be in place
  c.onRead(1, 2) // 20% of file
  c.onClose(1)
  await delay(20)

  t.deepEqual(calls, [
    ['miss', file],
    ['request', ['read', file]],
    ['cache', file],
    ['cache', DIR + '/file3.flac'],
    ['cache', DIR + '/file4.flac']
  ])
})

test('dont cache file due to read', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, preloadOpen: 10000, fs })
  const calls = getCalls(c)
  const file = DIR + '/file1.flac'

  await c.onOpen(1, file)
  c.onRead(1, 2) // 20% of file
  await delay(20) // now dize should be in place
  c.onRead(1, 2) // 20% of file
  c.onClose(1)
  await delay(20)

  t.deepEqual(calls, [['miss', file]])
})

test('clean some files', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs })

  await c.onOpen(1, DIR + '/file1.flac')
  await delay(100)
  c.onClose(1)

  t.is(fs.readdirSync('/cache' + DIR).length, 3)
  const calls = getCalls(c)

  const then = new Date(Date.now() - 10000)
  fs.utimesSync('/cache' + DIR + '/file4.flac', then, then)
  fs.utimesSync('/cache' + DIR + '/file1.flac', then, then)

  await c.clean(/^.*1\.flac$/, 5)
  t.deepEqual(calls, [['uncache', DIR + '/file4.flac']])
})

test('clean all files', async t => {
  const { fs } = t.context
  const c = new Cache({ ...options, fs, preloadSiblings: 1 })

  await c.onOpen(1, DIR + '/file1.flac')
  await delay(100)
  c.onClose(1)

  t.is(fs.readdirSync('/cache' + DIR).length, 2)
  const calls = getCalls(c)

  const then = new Date(Date.now() - 10000)
  fs.utimesSync('/cache' + DIR + '/file3.flac', then, then)
  fs.utimesSync('/cache' + DIR + '/file1.flac', then, then)

  await c.clean(/$./, 5)
  t.deepEqual(calls, [
    ['uncache', DIR + '/file1.flac'],
    ['uncache', DIR + '/file3.flac']
  ])
  t.deepEqual(fs.readdirSync('/cache'), [])
})

function makeFS (fs) {
  const dirs = ['/source', '/source/foo', '/source/foo/bar', '/cache']
  for (const d of dirs) {
    fs.mkdirSync(d)
  }

  const files = [
    'file1.flac',
    'file2.claf',
    'file3.flac',
    'file4.flac',
    'file5.flac'
  ]
  for (const f of files) {
    fs.writeFileSync(`/source/foo/bar/${f}`, 'data567890')
  }
}

async function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getCalls (cache) {
  const events = 'request cache uncache hit miss read error'.split(' ')
  const calls = []
  for (const event of events) {
    cache.on(event, data => calls.push([event, data]))
  }
  return calls
}
