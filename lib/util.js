/*
 * utilities
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

const debug = require('debug')('cachejs:util')
    , options = require('./options')
    , Path = require('pathlib')
    , Cmd = require('cmd')
    , util = require('util')
  ;



/*
 * realFile
 * filePath
 *
 * to convert from paths to physical files & vice versa
 */


async function copyFile(src, dst) {
    debug('Copying %s to %s', src, dst);

    src = new Path(src);
    dst = new Path(dst);

    // make parent dirs for dest
    await dst.parent().mkdirs();

    var rsync = new Cmd('rsync',
            ['-ptlWJ', src.path, dst.path],
            {stdout:{}, stderr:{}, progress:{}});

    await rsync.wait();

    await dst.load();

    return dst;
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


/*
 * text prettiness
 */


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
    copyFile:       copyFile,
    comma:          comma,
    rjust:          rjust,
    log:            log
};



