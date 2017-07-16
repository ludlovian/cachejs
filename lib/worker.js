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

const debug = require('debug')('cachejs:worker')
    , PromiseQueue = require('promise-queue')
    , options = require('./options')
    , log = require('./util').log
    ;

var q = new PromiseQueue({concurrency: 1});

module.exports = {
    async stop() {
        if (q) {
            await q.stop();
        }
        q = null;
    },

    push(desc, fn) {
        debug('pushing new work for: %s', desc);
        if( !q ) {
            log(3, 'Restarting worker');
            q = new PromiseQueue({concurrency: 1});
        }

        if (options.queueLimit &&
            q.working + q.waiting >= options.queueLimit) {
            debug('queue too long. Skipping %s', desc);
            return; // queue is too long
        }

        q.push(fn)
        .catch(err => {
            log(2, 'Work item failed: %s', desc);
            log(2, 'Error: %s', err);
            debug('%o', err);
            if (err.stack) { debug(err.stack); }
            log(2, 'Worker paused');
            q = null;
        });
    }
}

