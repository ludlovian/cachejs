/*
 * Main cachejs
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:index')
  , fuse = require('fuse-bindings')
  , options = require('./options')
  , log = options.log
  , ops = require('./ops')
  ;

if (options.options) {
    if (!Array.isArray(options.options)) {
        options.options = [options.options];
    }
    ops.options = options.options;
}

ops.force = true;

function start() {
    log('cachejs v%s', options.version);
    log('source:    %s', options.source);
    log('mount:     %s', options.mount);
    log('cache:     %s', options.cachedir);
    log('size:      %d MB', Math.floor(options.cachesize / (1024 * 1024)));
    log('housekeep: %d mins', Math.floor(options.housekeep / (60 * 1000)));
    log('options:   %s', ops.options || 'none');

    debug('mounting %s', options.mount);
    process.env.DEBUG = null;
    fuse.mount(options.mount.toString(), ops);
}

function stop() {
    debug('unmounting %s', options.mount);
    fuse.unmount(options.mount.toString(), () => { process.exit();});
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
