/*
 * Worker
 *
 * a class which creates workers
 *
 * A worker has tasks pushed into it
 *
 * It can also execute a special idle task after a certain idle period
 *
 * entry points
 *
 *  push(fn)         - add a promise producing function to the queue
 *  onIdle(fn,delay) - after we have been idle for `delay` then execute fn
 *  stop             - waits for the current item, and clears the queue
 *
 * options
 *  undozeDelay     - add a short delay when waking from sleep
 *  stopTimeout     - fail after this timeout
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:worker')
  , Promise = require('pixpromise')

  ;

function dieOnError(err) {
    console.error('uncaught rejection: ' + err +
            (err.stack ? '\n'+err.stack : ''));
    process.exit(1);
}

// given a user function, produce a sandboxed version guarantee to return a promise
function sandboxed(fn, ctx) {
    return () => {
        return new Promise((resolve, reject) => {
            resolve(fn.call(ctx));
        })
        .catch(dieOnError);
    };
}

// turn a promise producing function into a slightly delayed one
function delayed(fn, delay) {
    return () => {
        return Promise.delay(delay)
        .then(() => fn());
    };
}


class Worker {
    constructor(fn, opts) {
        opts = opts || {};

        // queue of work & head
        this._queue = [];
        this._currentItem = Promise.resolve();

        // status
        this._working = false;

        // idle function
        this._idle = {};

        // options
        this._undozeDelay = opts.undozeDelay || 100;
        this._stopTimeout = opts.stopTimeout || 10*1000;
    }

    /*Promise*/ push(fn, ctx) {
        fn = sandboxed(fn, ctx);
        if (!this._working && this._undozeDelay) {
            fn = delayed(fn, this._undozeDelay);
        }
        var item = {fn: fn, defer: Promise.defer()};
        this._queue.push(item);
        this._start();
        return item.defer.promise;
    }

    _start() {
        // clear any idle timeout if we are idling
        if (this._idle.timeout) {
            clearTimeout(this._idle.timeout);
            this._idle.timeout = null;
        }

        // do nothing if already working
        if (this._working)
            return;

        // something to do?
        if (this._queue.length) {
            var item = this._queue.shift();
            this._working = true;
            this._currentItem = item.defer.promise;
            // kick off new work
            item.fn()
            .then(result => {
                this._working = false;
                item.defer.resolve(result);
                this._start();
            });
        } else if (this._idle.fn) {
            this._idle.timeout = setTimeout(
                () => {
                    this.push(this._idle.fn, this._idle.ctx);
                }, this._idle.delay);
        }
    }

    onIdle(delay, fn, ctx) {
        this._idle.delay = delay;
        this._idle.fn = fn;
        this._idle.ctx = ctx;
        this._start();
    }

    /*Promise*/ stop() {
        this._queue = [];
        this._idle.fn = null;
        this._start(); // this will just clear any timers
        var p = this._currentItem;
        if (this._stopTimeout) {
            p = p.timeout(this._stopTimeout);
        }
        return p;
    }

}

module.exports = Worker;
