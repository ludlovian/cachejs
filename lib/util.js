/*
* utilities
*
*/

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
* Requires & promisifieds
*/

const
  Path = require('pathlib'),
  Cmd = require('cmd'),

  Debug = require('debug'),
  debug = Debug('cachejs:util');

// istanbul ignore next
exports.fatalError = function(err) {
  process.nextTick(() => { throw err; })
};

exports.copyFile = async function copyFile(src, dst) {
  debug('Copying %s to %s', src, dst);

  src = new Path(src);
  dst = new Path(dst);

  // make parent dirs for dest
  await dst.parent().mkdirs();

  var rsync = new Cmd('rsync',
    [ '--perms', '--times', '--links', '--whole-file', '--omit-link-times',
      src.path, dst.path ],
    { stdout: {}, stderr: {}, progress: {} }
  );

  await rsync.wait();

  await dst.load();

  return dst;
};


/*
* text prettiness
*/

/*
exports.comma = function comma(n) {
 return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

exports.rjust = function rjust(pad, s) {
 return (pad + s).slice(-pad.length);
};
*/

