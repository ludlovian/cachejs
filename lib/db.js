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

var debug = require('debug')('cachejs:db')
  , Promise = require('pixpromise')
  , Datastore = require('nedb')
  , options = require('./options')
  , Path = require('pathlib')

  ;

var cacheroot = Path(options.cachedir);

var db = new Datastore({
        filename: cacheroot.join('cache.db') + ''
        });


/* start & stop */
function /*Promise*/ start() {
    debug('starting');

    // start the database
    return load()

    // unset any refcounts
    .then(() => update(
        {refcount: {$gt: 0}},
        {$set: {refcount: 0}},
        {multi: true}
    ))

    // remove any records not cached
    .then(() => remove(
        {$not: { cached: true }},
        {multi: true}
    ))

    .tap(() => debug('started'))
    ;
}
exports.start = start;

function /*Promise*/ stop() {
    debug('stopping');
    return compact()
    .tap(() => debug('stopped'))
    ;
}
exports.stop = stop;

function /*Promise*/ load() {
    return new Promise((resolve, reject) => {
        db.loadDatabase(err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function /*Promise*/ find(query, opts) {
    opts = opts || {};
    debug('find: %o %o', query, opts);
    return new Promise((resolve, reject) => {
        var cursor = db.find(query, opts.project);
        if (opts.sort)
            cursor = cursor.sort(opts.sort);
        if (opts.limit)
            cursor = cursor.limit(opts.limit);
        cursor.exec((err, recs) => {
            if (err) return reject(err);
            debug('find = %o', recs);
            resolve(recs);
        });
    });
}
exports.find = find;

function /*Promise*/ findOne(query, opts) {
    opts = opts || {};
    opts.limit = 1;
    return find(query, opts)
    .then(recs => recs.length ? recs[0] : null);
}
exports.findOne = findOne;

function /*Promise*/ update(query, update, options) {
    options = options || {};
    debug('update %o %o %o', query, update, options);
    return new Promise((resolve, reject) => {
        db.update(query, update, options, (err, num, docs, upsert) => {
            if (err) return reject(err);
            var result = {num:num};
            if (docs)
                result.docs = docs;
            if (upsert)
                result.upsert = upsert;
            debug('update = %o', result);
            resolve(result);
        });
    });
}
exports.update = update;

function /*Promise*/ insert(rec) {
    debug('insert %o', rec);
    return new Promise((resolve, reject) => {
        db.insert(rec, (err, rec) => {
            if (err) return reject(err);
            debug('insert = %o', rec);
            resolve(rec);
        });
    });
}
exports.insert = insert;

function /*Promise*/ remove(query, options) {
    options = options || {};
    debug('remove %o %o', query, options);
    return new Promise((resolve, reject) => {
        db.remove(query, options, (err, num) => {
            if (err) return reject(err);
            debug('remove = %s', num);
            resolve(num);
        });
    });
}
exports.remove = remove;

function /*Promise*/ compact(timeout) {
    timeout = timeout || 10 * 1000; // 10 seconds
    debug('compacting');
    return new Promise((resolve, reject) => {
        db.persistence.compactDatafile();
        db.once('compaction.done',resolve);
    })
    .timeout(timeout)
    .tap(() => debug('compacted'));
}
exports.compact = compact;





