'use strict'

import test from 'ava'

import getVfs from '../src/vfs'
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

test('vfs activity', async t => {
  const fs = new MemFS()
  makeFS(fs)
  const [vfs, cache] = getVfs({ ...options, fs })
  const calls = getCalls(cache)
  const buf = Buffer.alloc(10)

  const [err, fd] = await vfs.invoke('open', DIR + '/file1.flac', 0)
  t.falsy(err)

  await delay(50)

  const [bytes] = await vfs.invoke('read', DIR + '/file1.flac', fd, buf, 4, 0)
  t.is(bytes, 4)

  await delay(50)

  await vfs.invoke('release', fd)

  const [err2, files] = await vfs.invoke('readdir', '/foo')
  t.falsy(err2)
  t.deepEqual(files, ['bar'])

  t.deepEqual(calls, [
    ['miss', DIR + '/file1.flac'],
    ['request', ['time', DIR + '/file1.flac']],
    ['cache', DIR + '/file1.flac'],
    ['cache', DIR + '/file3.flac'],
    ['cache', DIR + '/file4.flac']
  ])
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
