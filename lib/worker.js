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

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

require('pixpromise'); // fixup promise

// standard queue - concurrency:1, limit:Infinite
var worker = Promise.queue();

// add in redundant .start
worker.start = () => Promise.resolve();

module.exports = worker;
