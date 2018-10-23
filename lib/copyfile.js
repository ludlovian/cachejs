'use strict'

const { dirname, resolve } = require('path')

const { promisify } = require('util')
const mkdirp = require('mkdirp')

const assert = require('assert')
const debug = require('debug')('cachejs:copyfile')

exports = module.exports = copyFile
exports.fs = require('fs') // default `fs` to use

// copyFile
//
// rsync-like copy via a temp file, and copying mtime as well
//
// does not copy if the size & mtime are the same
//
//    copyFile(src, dst, opts)
//
//    options:
//      .fs   which fs to use, or the module `fs`
//

async function copyFile (src, dst, options = {}) {
  assert(typeof src === 'string', 'source path must be a string')
  assert(typeof dst === 'string', 'destination path must be a string')
  assert(typeof options === 'object', 'options must be an object')

  const fs = options.fs || exports.fs

  src = resolve(src)
  dst = resolve(dst)

  const filesAreSame = await compareFiles(src, dst, fs)

  if (filesAreSame) {
    debug('Skipping redundant copy of %s to %s', src, dst)
    return
  }

  debug('Copying %s to %s', src, dst)

  const tmpDest = makeTempName(dst)

  await ensureContainingDirExists(dst, fs)
  await copyToTempFile(src, tmpDest, fs)
  await copyStats(src, tmpDest, fs)
  await renameInPlace(tmpDest, dst, fs)
}

async function compareFiles (src, dst, fs) {
  const stat = promisify(fs.stat)
  const srcStat = await stat(src)
  var dstStat

  try {
    dstStat = await stat(dst)

    if (statsAreSame(srcStat, dstStat)) return true

    return false
  } catch (err) {
    // not the same if the destination is missing
    // istanbul ignore else
    if (err.code === 'ENOENT') return false
    // istanbul ignore next
    throw err
  }
}

function statsAreSame (s1, s2) {
  return s1.size === s2.size && Math.abs(s1.mtimeMs - s2.mtimeMs) < 1000
}

function makeTempName (dst) {
  return dst + '~' + (Math.random().toString(36).slice(2, 8))
}

async function ensureContainingDirExists (dst, fs) {
  const parent = dirname(dst)
  debug('ensuring %s exists', parent)
  await promisify(mkdirp)(parent, { fs })
}

async function copyToTempFile (src, dst, fs) {
  const cp = promisify(fs.copyFile)
  try {
    await cp(src, dst)
    debug('%s copied to %s', src, dst)
  } catch (err) {
    await maybeUnlink(dst, fs, err)
    throw err
  }
}

async function copyStats (src, dst, fs) {
  const stat = promisify(fs.stat)
  const utimes = promisify(fs.utimes)

  const stats = await stat(src)
  await utimes(dst, stats.atimeMs / 1000, stats.mtimeMs / 1000)
  debug('stats updated for %s', dst)
}

async function renameInPlace (src, dst, fs) {
  const rename = promisify(fs.rename)
  try {
    await rename(src, dst)
    debug('%s renamed in place to %s', src, dst)
  } catch (err) {
    await maybeUnlink(src, fs, err)
    await maybeUnlink(dst, fs, err)
    throw err
  }
}

async function maybeUnlink (path, fs, errContext) {
  debug('tring to remove %s', path)
  const unlink = promisify(fs.unlink)
  try {
    await unlink(path)
  } catch (err) {
    if (err.code === 'ENOENT') {
      debug('didn\'t exist, but that\'s ok')
      return
    }
    debug('Error whilst unlinking %s', path)
    err.context = errContext
    throw err
  }
}
