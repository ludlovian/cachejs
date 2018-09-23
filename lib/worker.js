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
* All implemented by promise-queue
*
*/

'use strict';

/*
* Requires & promisifieds
*/

const
  PromiseQueue = require('promise-queue'),

  config = require('./config'),
  log = require('./log'),

  Debug = require('debug'),
  debug = Debug('cachejs:worker');

const q = new PromiseQueue({ concurrency: 1 });

const worker = {
  stop() { /* istanbul ignore next */ return q.stop(); },

  clear() { /* istanbul ignore next */ return q.clear(); },

  idle() { return q.wait(); },

  async push(desc, fn) {
    debug(desc);

    // istanbul ignore if
    if (config.queueLimit &&
      q.working + q.waiting >= config.queueLimit) {
      debug('queue too long. Skipping %s', desc);
      return; // queue is too long
    }

    return q.push(fn)
      .catch(
        /* istanbul ignore next */
        err => handleError(err, desc));
  }
};

// istanbul ignore next
function handleError(err, desc) {
  log(2, 'Work item failed: %s', desc);
  log(2, 'Error: %s', err);
  debug('%o', err);
  if (err.stack) { debug(err.stack); }

  return worker.clear(); // clear current work as it is having a paddy
}

module.exports = worker;

