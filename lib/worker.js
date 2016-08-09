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
    constructor(fn) {
        this.fn = fn;
        this._currentItem = Promise.resolve(); // promise of current workitem
        this._timeout = null; // current timeout (if sleeping)
        this.state = STOPPED;
    }

    isStopped() { return this.state === STOPPED; }
    isDozing() { return this.state === DOZING; }

    /*Promise*/ start() {
        debug("starting");
        if (!this.isStopped()) return Promise.reject(
            new Error("worker already started"));
        return this._performWork();
    }

    /*Promise*/ _performWork() {
        // kick off item of work
        this.state = WORKING;
        this._currentItem = this.fn()
            .catch(dieOnError);
        // repeat, doze or quit
        this._currentItem.then(val => {
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