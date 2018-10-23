'use strict'

const { dirname, resolve } = require('path')

const { promisify } = require('util')

const assert = require('assert')
const debug = require('debug')('cachejs:fileutil')

// removeFile
//
// removes a file, and all its parent dirs if empty, up to a point
//
// opts:
//  .top      the topmost dir to keep (def: '/')
//  .fs       the `fs` to use (def: the module's `fs`)
//

exports = module.exports = removeFile
exports.fs = require('fs')

async function removeFile (path, opts = {}) {
  assert(typeof path === 'string', 'path to remove must be a string')
  assert(typeof opts === 'object', 'options must be an object')

  const top = opts.top ? resolve(opts.top) : '/'
  const fs = opts.fs || exports.fs
  const unlink = promisify(fs.unlink)

  path = resolve(path)

  debug('removing %s', path)

  await unlink(path)

  await maybeRmdir(dirname(path), top, fs)
}

async function maybeRmdir (path, top, fs) {
  // quit unless path is a descendant of top
  if (!path.startsWith(top) || path.length <= top.length) return

  const rmdir = promisify(fs.rmdir)

  try {
    await rmdir(path)
    debug('removed empty dir %s', path)
  } catch (err) {
    if (err.code === 'ENOTEMPTY') return

    debug('Error whilst rmdir %s: %o', path, err)

    throw err
  }

  return maybeRmdir(dirname(path), top, fs)
}
