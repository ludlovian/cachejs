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
  , log = require('./util').log
  , ops = require('./ops')
  , cache = require('./cache')
  , worker = require('./worker')
  ;


function start() {
    log(1, 'cachejs v%s', options.version);
    log(1, 'cache:    %s', options.cache);
    log(1, 'mount:    %s', options.mount);
    log(1, 'options:  %j', options.fuseOptions);

    debug('mounting %s', options.mount);
    process.env.DEBUG = null;
    ops.options = options.fuseOptions;
    ops.force = true;
    fuse.mount(options.mount.toString(), ops);
}

function stop() {
    debug('unmounting %s', options.mount);
    fuse.unmount(options.mount.toString(), () => {
        log(1, 'Ended.');
        process.exit();
    });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', () => {
    log(1, 'HUP received. Reloading.');
    worker.push(() => cache.load());
});

start();
