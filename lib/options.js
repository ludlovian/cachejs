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

var parseArgs = require('minimist')
  , isString = require('util').isString
  , debug = require('debug')('raidy:options')
  , util = require('util')
  , version = require('../package').version
  , Path = require('pathlib')
  , statSync = require('fs').statSync
  ;

var helpText, aliasMap, opts;

aliasMap = {
  h: 'help',
  v: 'version',
  d: 'dir',
  s: 'size',
  c: 'cache',
  t: 'time',
  o: 'options'
};

/*
 * Options object
 *
 * The main export is one of these
 */

class Options {
    constructor() {
        this._clear();
    }

    _clear() {
        this.version = version;
        this.source = null;
        this.mount = null;
        this.filter = null;
        this.cachedir = null;
        this.cachesize = null;
        this.timeout = null;
        this.options = null;
    }

    reparse(args) {
        var o, rgx;
        this._clear();

        // read in the command line
        o = readCommandLine(args);

        this.source = Path(o._[0] || 'src');
        this.mount = Path( o._[1] || 'mnt');
        checkExists(this.source);
        checkExists(this.mount);

        if (o.cache) {
            rgx = new RegExp(o.cache);
            this.filter = p => rgx.test(p.toString());
        } else {
            this.filter = p => true;
        }

        this.cachedir = Path(o.dir || '.');
        checkExists(this.cachedir);

        this.cachesize = (o.size || 10*1024) * 1024*1024;
        this.timeout = (o.time || 6*60) * 60*1000;
        if (o.options) {
            let optList = o.options + '';
            if (Array.isArray(o.options)) {
                optList = o.options.join(',');
            }
            this.options = optList.split(',');
        }

        return this;
    }

    log() {
        var args = Array.from(arguments);
        var s = util.format.apply(util, args);
        console.log(s);
    }
}


/*
 * We read the command line via minimist and pre-catch the help
 * or version commands
 */
function readCommandLine(cmdlineArgs) {
    var o, config, k;
    if (isString(cmdlineArgs)) {
        cmdlineArgs = cmdlineArgs.split(' ');
    }
    if (!cmdlineArgs) {
        cmdlineArgs = process.argv.slice(2);
    }

    // parse the command line with minimist
    o = parseArgs(cmdlineArgs, {
        alias: aliasMap
    });

    // do --help or --version
    if (o.help) { showHelp(); }
    if (o.version) { showVersion(); }

    return o;
}


/*
 * Die with an error
 */
function die(message) {
    console.log("ERROR: " + message);
    process.exit(1);
}

function checkExists(p) {
    try {
        statSync(p.toString());
    } catch (e) {
        if (e.code === 'ENOENT') {
            die(p + " does not exist");
        }
        else throw e;
    }
}

function showHelp() {
    console.log(helpText);
    return process.exit();
}

function showVersion() {
    console.log("cachejs v" + version);
    return process.exit();
}


helpText = "cachejs v" + version
  + "\n"
  + "FUSE filesystem which pre-caches reads to speed up streaming if the\n"
  + "underlying filesystem stutters\n"
  + "\n"
  + "Syntax:\n"
  + "  cachejs [options] source mount\n"
  + "\n"
  + "Options:\n"
  + "  -d|--dir <dir>     the dir to store cahce files in (def: current)\n"
  + "  -s|--size <size>   the max size (in MB)\n"
  + "  -t|--time <mins>   how long to keep in the cache\n"
  + "  -c|--cache <regex> files to cache (def: everything)\n"
  + "\n";


module.exports = opts = new Options();
opts.reparse();

