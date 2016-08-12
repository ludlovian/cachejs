/*
 * Worker
 *
 * a class which creates workers
 *
 * A worker works when prompted, but also on a schedule (when dozing)
 *
 *
 * Constructor takes the following:
 *  -   fn      the callback to perform an item of work. It should return a
 *              promise of completion. Any rejection will abend the program
 *
 *              The resolution value should be falsy if there is more work
 *              to do (the callback will be called again). Or it should
 *              return a numeric value of how long to doze for.
 *
 *
 *  And methods:
 *  -   start   to start the worker
 *  -   wake    (Promise) if dozing, starts a new work item. Returns
 *              completion of the current work item
 *  -   stop    (Promise) stops after the current workitem and
 *              stops the worker
 *
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

var STOPPED = 'STOPPED'     // not yet started
  , DOZING = 'DOZING'       // idling, asleep
  , WORKING = 'WORKING'     // running workitem
  , STOPPING = 'STOPPING'   // running, but being asked to stop
  ;

class Worker {
    constructor(fn, opts) {
        opts = opts || {};
        this.fn = fn;
        this._currentItem = Promise.resolve(); // promise of current workitem
        this._timeout = null; // current timeout (if sleeping)
        this._undozeDelay = opts.undozeDelay || 100; // wait 100ms on waking
        this.state = STOPPED;
    }

    isStopped() { return this.state === STOPPED; }
    isDozing() { return this.state === DOZING; }
    isWorking() { return this.state === WORKING; }

    /*Promise*/ start() {
        debug("starting");
        if (!this.isStopped()) return Promise.reject(
            new Error("worker already started"));
        this.state = DOZING;
        return this._performWork();
    }

    /*Promise*/ _performWork() {
        /* kicks off any new work (tacked onto the current item)
         *
         * On entry, can be dozing (in which case we prepend
         * a brief wait) or working (in which we get on with it)
         *
         * Returns the current work item (without the recursion bit)
         * */

        // if we are not already working (i.e. waking from a doze, or first
        // time), then we sleep for a wee bit.
        var p = this._currentItem;

        if (this.isDozing()) {
            p = p.then(() => Promise.delay(this._undozeDelay));
        }

        this.state = WORKING;
        // kick off new item of work
        p = p.then(() => this.fn())
            .catch(dieOnError);

        // tack repeat, doze or quit onto the end
        p.then(val => {
            if (this.state === STOPPING) {
                return; // fall out of loop
            }
            if (!val) {
                return this._performWork(); // loop again
            } else {
                this._doze(val);
                return; // current item is complete
            }
        }).catch(dieOnError);

        this._currentItem = p;
        return this._currentItem;
    }

    _doze(interval) {
        debug("dozing");
        this.state = DOZING;
        this._timeout = setTimeout(() => this.wake(), interval);
    }

    _undoze() {
        clearTimeout(this._timeout);
        this._timeout = null;
    }

    /*Promise*/ stop() {
        debug("stopping");
        if (this.isStopped()) return Promise.reject(
                new Error("worker already stopped"));
        if (this.isDozing()) {
            this._undoze();
        }
        // signal stoppping
        this.state = STOPPING;
        return this._currentItem
        .then(() => {
            debug('stopped');
            this.state = STOPPED;
        }).catch(dieOnError);
    }

    /*Promise*/ wake() {
        if (this.isStopped()) return Promise.reject(
                new Error("worker not started"));
        if (this.isDozing()) {
            this._undoze();
            debug('waking');
            return this._performWork();
        } else {
            return this._currentItem;
        }
    }
}

module.exports = Worker;
