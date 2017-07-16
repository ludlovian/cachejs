/*
 * File objects
 *
 * Passthru file is a simple pass thru file version
 *
 *
 */

'use strict';

/*
 * Requires & promisifieds
 */


const debug = require('debug')('cachejs:passthru')
    , fs = require('fs-extra')
    , thenify = require('thenify')

    , openFile = thenify(fs.open)
    , readFile = thenify(fs.read)
    , closeFile = thenify(fs.close)

    , Path = require('pathlib')

    ;

/*
 * PassthruFile
 *
 * Simple passthru mechanism
 *
 */

class PassthruFile{
    constructor(root, path) {
        this.root = new Path(root);
        this.path = new Path(path);
        this.fd = null;
        this.isOpen = false;
        debug('creating file for %s', this.path);
    }

    inspect() {
        return 'PassthruFile(' + this.path + ')';
    }

    realFile() {
        return this.root.join(this.path);
    }

    async open() {
        debug('opening %s', this.path);
        var f = this.realFile();
        this.fd = await openFile(f.path, 'r');
        this.isOpen = true;
    }

    async read(buffer, length, position) {
        // read returns [count, buffer]
        var result = await readFile(this.fd, buffer, 0, length, position);
        // we return count
        return result[0];
    }

    async close() {
        await closeFile(this.fd);
        this.isOpen = false;
    }
}

module.exports = PassthruFile;
