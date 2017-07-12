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

async function copyFile(src, dst) {
    debug('Copying %s to %s', src, dst);

    // make parent dirs for dest
    dst = new Path(dst);
    await dst.parent().mkdirs();

    var rsync = new Cmd('rsync',
            ['-ptlWJ', src + '', dst + ''],
            {stdout:{}, stderr:{}, progress:{}});

    await rsync.wait();
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
    realFile:       realFile,
    filePath:       filePath,
    copyFile:       copyFile,
    comma:          comma,
    rjust:          rjust,
    log:            log
};



