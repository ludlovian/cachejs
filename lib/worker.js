/*
 * Worker
 *
 * The worker has tasks pushed into it
 *
 * entry points
 *
 *  push(fn)         - add a promise producing function to the queue
 *  start/stop
 *  drain
 *
 * All implemented by <pixpromise>.queue
 *
 */

'use strict';

/*
 * Requires & promisifieds
 */

const debug = require('debug')('cachejs:db')
    , PromiseQueue = require('promise-queue')
    , options = require('./options');

var q = new PromiseQueue({concurrency: 1});

module.exports = {
    start() {},

    async stop() {
        await q.stop();
    },

    push(fn) {
        debug('pushing new work: %o', fn);
        if (options.queueLimit &&
            q.working + q.waiting >= options.queueLimit) {
            debug('queue too long');
            return; // queue is too long
        }
        q.push(fn);
        debug('pushed');
    }
}

