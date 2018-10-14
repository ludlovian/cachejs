'use strict'

//
// Generic debug & assertion module
//
// Uses 'debug' if installed, but happily fails without
//
// Only invoked if not in a `production` mode
//
// Usage:
//
//    const { de, bug, mand } = require('.debug')('modName')
//
//    de&&mand.ok('assertion', 'message')
//
//    de&&bug('message with %s', parms)
//


//
// What should the prefix be for debug messages? Usually the project name

const DEBUG_PREFIX = require('../package.json').name


//
// How we detect if in production
//
const isInProduction = /^prod/i.test(process.env.NODE_ENV)
const isAnyDebugging = !!process.env.DEBUG

// enable if not in productin OR if there is any DEBUG set
// istanbul ignore next
const de = !isInProduction || isAnyDebugging

const mand = require('assert')

//
// A NOP debug function
// istanbul ignore next
function NOPDebug() {}
NOPDebug.enabled = false // debug sets this, so we do too.

// And a factory to produce this - analagous to require('debug')
// istanbul ignore next
function NOPDebugFactory() { return NOPDebug }

const Debug = (() => {
// istanbul ignore catch
  try {
    return require('debug') // try to load the real one
  } catch (err) {
    // istanbul ignore next
    return NOPDebugFactory  // return the NOP factory
  }
})()

module.exports = function(name) {
  de&&mand(typeof name === 'string', 'namespace must be given')

  // istanbul ignore else
  if (name[0] === '/')
    name = require('path').basename(name, '.js')

  const bug = Debug(`${DEBUG_PREFIX}:${name}`)
  return { de, mand, bug }
}
