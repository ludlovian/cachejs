/*
 * Options loading
 *
 * - parses the command line via minimist
 *
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var isString = require('util').isString
  , fs = require('fs')
  , debug = require('debug')('cachejs:options')
  , util = require('util')
  , version = require('../package').version
  , Path = require('pathlib')
  ;

/*
 * Options object
 *
 * The main export is one of these
 */

class Options {
    constructor() {
        this.version = version;
    }

    load(args) {
        if (isString(args))
            args = args.split(' ');

        if (!args)
            args = process.argv.slice(2);

        debug('loading options. args=%o', args);

        this.cache = Path(args[0] || '').resolve();
        this.mount = Path(args[1] || '').resolve();

        var opts = JSON.parse(fs.readFileSync(
                    this.cache.join('options.json')+'', 'utf8'));

        this.source = Path(opts.source || '').resolve();
        this.cachesize = (opts.cachesize || 10*1024) * 1024*1024;
        if (opts.filter) {
            let rgx = new RegExp(opts.filter);
            this.filter = p => rgx.test(p.toString());
            this.filterSource = opts.filter;
        } else {
            this.filterSource = 'none';
            this.filter = p => true;
        }
        this.loadDelay = (opts.loadDelay || 1000);
        this.siblings = (opts.siblings || 3); // load next 3 siblings
        this.fuseOptions = (opts.fuseOptions || []);
        this.logLevel = (opts.logLevel || 1);
        this.queueLimit = 0; // only queue if nothing waiting
        this.touchLimit = 2; // queue cache after 2 recent touches
        this.recentCount = 2; // how many files are "recent"
    }

}

module.exports = new Options();
module.exports.load();

