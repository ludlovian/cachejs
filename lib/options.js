/*
 * Options loading
 *
 * - parses the command line via minimist
 *
 */

'use strict';

/*
 * Requires & promisifieds
 */

const fs = require('fs')
    , debug = require('debug')('cachejs:options')
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

        args = typeof args === 'string' ? args.split(' ')
             : !args                    ? process.argv.slice(2)
             :                            args;

        debug('loading options. args=%o', args);

        this.cache = new Path(args[0] || '').resolve();
        this.mount = new Path(args[1] || '').resolve();

        var opts = {};
        try {
            opts = JSON.parse(fs.readFileSync(
                this.cache.join('options.json')+'', 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') { throw err; }
        }

        this.source = new Path(opts.source || '').resolve();
        this.cachesize = (opts.cachesize || 10*1024) * 1024*1024;
        if (opts.filter) {
            let rgx = new RegExp(opts.filter);
            this.filter = p => rgx.test(p.toString());
            this.filterSource = opts.filter;
        } else {
            this.filterSource = 'none';
            this.filter = () => true;
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

