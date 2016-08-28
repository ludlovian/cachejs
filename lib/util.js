/*
 * utilities
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

require('pixpromise'); // fixup promise

var options = require('./options')
  , Path = require('pathlib')
  , util = require('util')
  ;


/*
 * Alarm
 *
 * A cancellable (promise of) timer
 *
 */

class Cancelled extends Error {
    constructor(msg) {
        super(msg);
    }
}

function alarm(delay) {
    var d = Promise.defer();
    var al = d.promise;

    function fire() {
        timer = null;
        d.resolve();
    }
    function cancel() {
        if(timer)
            clearTimeout(timer);
        timer = null;
        d.reject(new Cancelled('Alarm cancelled before firing'));
    }

    var timer = setTimeout(fire, delay);
    al.cancel = cancel;
    return al;
}
alarm.Cancelled = Cancelled;


/*
 * realFile
 * filePath
 *
 * to convert from paths to physical files & vice versa
 */

var root = options.source
  , cacheRoot = options.cache.join('files')

  , rootLen = root.path.length
  , cacheRootLen = cacheRoot.path.length
  ;

function realFile(path, cached) {
    return (cached ? cacheRoot : root).join(path);
}
function filePath(path, cached) {
    return new Path(
        path.toString().slice(cached ? cacheRootLen : rootLen)
    );
}


function log() {
    var args = Array.from(arguments);
    var level = args.shift(1);
    if (level > options.logLevel) {
        //console.log('ignoring message (%d > %d) %s', level, options.logLevel, args)
        return;
    }
    var s = util.format.apply(util, args);
    console.log(s);
}



function comma(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function rjust(pad, s) {
  return (pad + s).slice(-pad.length);
}

/*
 * Exports
 *
 */

module.exports = exports = {
    alarm:      alarm,
    realFile:   realFile,
    filePath:   filePath,
    comma:      comma,
    rjust:      rjust,
    log:        log
};



