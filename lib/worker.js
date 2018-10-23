/*
* Worker
*
* The worker has tasks pushed into it
*
* entry points
*
*  push(desc, fn)         - add a promise producing function to the queue
*  stop
*
*/

'use strict'

/*
* Requires & promisifieds
*/

const PQueue = require('p-queue')
const config = require('config')

const log = require('./log')

const debug = require('debug')('cachejs:worker')

const q = new PQueue({ concurrency: 1 })

function push (desc, fn) {
  debug(desc)

  const queueLimit = config.get('queueLimit')

  if (queueLimit && q.pending + q.size >= queueLimit) {
    debug('queue too long. Skipping %s', desc)
    log.warn('Skipping: %s', desc)
    return Promise.resolve()
  }

  return q.add(fn).catch(err => {
    debug('%o', err)

    log.warn('Work item failed: %s', desc)
    log.warn('Error: %s', err)

    // clear current work as it having a moment
    q.clear()
  })
}

function stop () {
  // remove any un started jobs
  q.clear()

  // and wait until idle
  return q.onIdle()
}

module.exports = {
  push,
  stop
}
