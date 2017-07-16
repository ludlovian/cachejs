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


const DEFAULTS = {
    source: '.',
    loadDelay: 1000,
    siblings: 3,
    logLevel: 1,
    fuseOptions: [],
    queueLimit: 10,
    touchLimit: 2,
    recentCount: 2,
    filter: undefined
};

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

        if (typeof args === 'string') {
            args = args.split(' ');
        } else if (!args) {
            args = process.argv.slice(2);
        }
        debug('loading options. args=%o', args);

        var cache = new Path(args[0] || '').resolve();
        this.mount = new Path(args[1] || '').resolve();

        Object.assign(this, DEFAULTS,
                getOptions(cache.join('options.json')));

        // post-load process
        this.cache = cache.join('files');
        this.source = new Path(this.source).resolve();
        this.cachesize = this.cachesize * 1024 * 1024;
        this.filterSource = this.filter;
        if (this.filterSource) {
            let rgx = new RegExp(this.filterSource);
            this.filter = p => rgx.test(p.toString());
        } else {
            this.filterSource = 'none';
            this.filter = () => true;
        }
        return this;
    }


}

function getOptions(optsFile) {
    try {
        return JSON.parse(fs.readFileSync(optsFile.path));
    } catch (err) {
        if (err.code === 'ENOENT') {
            return {};
        }
        throw err;
    }
}

module.exports = new Options();
module.exports.load();

