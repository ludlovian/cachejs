/*
 * db
 *
 * the nedb database
 *
 * Promise-wrappers around usual nedb things
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

const debug = require('debug')('cachejs:db')
    , Datastore = require('nedb-promise')
    , options = require('./options')
    ;

const cacheroot = options.cache;

var db = new Datastore({filename: cacheroot.join('cache.db') + ''});

module.exports = db;

db.start = async function() {
    debug('starting');
    await db.loadDatabase();
    debug('started');
};

db.stop = async function() {};

db.compact = function() {
    debug('compacting database');
    return new Promise((resolve, reject) => {
        var tm = setTimeout(reject, 5000, new Error('compaction timed out'));
        this.nedb.once('compaction.done', () => {
            debug('compacted');
            clearTimeout(tm);
            resolve(true);
        });
        this.nedb.persistence.compactDatafile();
    });
};






