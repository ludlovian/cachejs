'use strict'

import { format } from 'util'

function NOOP () {}

export default class Report {
  constructor (options) {
    this.options = options
    this.level = getLevel(options)
    for (const [msg, msgLevel, fn] of Messages) {
      if (msgLevel > this.level) {
        this[msg] = NOOP
      } else {
        this[msg] = (...args) => this.log(fn.apply(this, args))
      }
    }
  }

  msg (event, ...args) {
    if (!(event in this)) return
    this[event](...args)
  }

  log (...args) {
    console.log(...args)
  }

  attach (emitter) {
    for (const [msg] of Messages) {
      emitter.on(msg, this[msg].bind(this))
    }
  }
}

function getLevel ({ quiet, verbose }) {
  if (quiet) return 0
  if (typeof verbose === 'number') return verbose
  if (Array.isArray(verbose)) return verbose.length + 1
  return verbose ? 2 : 1
}

const Messages = [
  ['started', 1, () => 'started'],
  ['stopped', 1, () => 'stopped'],
  [
    'heading',
    1,
    function () {
      const { version, sourceDir, cacheDir, mountDir } = this.options
      return (
        `cachejs v${version}\n` +
        `source : ${sourceDir}\n` +
        `cache  : ${cacheDir}\n` +
        `mount  : ${mountDir}\n`
      )
    }
  ],
  ['cleaning', 2, () => 'cleaning cache'],
  ['error', 0, err => format('ERROR %o', err)],
  ['cache', 2, path => `CACHE   ${path}`],
  ['uncache', 2, path => `UNCACHE ${path}`],
  ['hit', 3, path => `HIT     ${path}`],
  ['miss', 3, path => `MISS    ${path}`],
  ['read', 3, path => `READ    ${path}`],
  [
    'request',
    4,
    ([reason, path]) =>
      format('%s %s', reason === 'time' ? 'RQ-TIME' : 'RQ-READ', path)
  ]
]
