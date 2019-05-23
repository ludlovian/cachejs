'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var sade = _interopDefault(require('sade'));
var realFs = _interopDefault(require('fs'));
var FuseFS = _interopDefault(require('fuse-fs'));
var util = require('util');
var path = require('path');
var PLock = _interopDefault(require('plock'));
var TimedTrigger = _interopDefault(require('timed-trigger'));
var Emitter = _interopDefault(require('emitter'));
var filescan = _interopDefault(require('filescan'));

var version = "1.5.0";

const priv = Symbol('priv');
class Cache extends Emitter {
  constructor (options) {
    super();
    Object.defineProperty(this, priv, { value: getPrivate(options) });
  }
  async readdir (path$1) {
    const { sourceDir, readdir } = this[priv];
    return readdir(path.join(sourceDir, path$1))
  }
  async locate (path$1) {
    const {
      mruFiles,
      mruSize,
      preloadFilter,
      lstat,
      sourceDir,
      cacheDir
    } = this[priv];
    let rec = mruFiles.get(path$1);
    if (rec) {
      mruFiles.delete(path$1);
      mruFiles.set(path$1, rec);
      return rec
    }
    rec = {
      path: path$1,
      fullpath: path.join(cacheDir, path$1),
      cached: true,
      cacheable: preloadFilter.test(path.basename(path$1))
    };
    try {
      rec.stats = await lstat(rec.fullpath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      rec.fullpath = path.join(sourceDir, path$1);
      rec.cached = false;
      rec.stats = await lstat(rec.fullpath);
    }
    mruFiles.set(path$1, rec);
    if (mruFiles.size > mruSize) {
      mruFiles.delete(mruFiles.keys().next().value);
    }
    return rec
  }
  async onOpen (fd, path$1) {
    const { openFiles, preloadOpen, preloadFilter } = this[priv];
    if (!preloadFilter.test(path.basename(path$1))) {
      this.emit('read', path$1);
      return
    }
    const { cached } = await this.locate(path$1);
    this.emit(cached ? 'hit' : 'miss', path$1);
    const rec = {
      path: path$1,
      trigger: new TimedTrigger(),
      read: 0
    };
    openFiles.set(fd, rec);
    rec.trigger.fireAfter(preloadOpen, 'time');
    rec.trigger.then(reason =>
      execute(this, () => requestCache(this, reason, path$1))
    );
    execute(this, () => getFileSize(this, rec));
  }
  onRead (fd, bytes) {
    const { openFiles, preloadRead } = this[priv];
    const rec = openFiles.get(fd);
    if (!rec) return
    rec.read += bytes;
    if (typeof rec.size === 'number') {
      const threshold = (preloadRead * rec.size) / 100;
      if (rec.read > threshold) rec.trigger.fire('read');
    }
  }
  onClose (fd) {
    const { openFiles } = this[priv];
    const rec = openFiles.get(fd);
    if (!rec) return
    rec.trigger.clear();
    openFiles.delete(fd);
  }
  clean (cleanIgnore, cleanAfter) {
    cleanIgnore = ensureRegex(cleanIgnore);
    const { cacheDir, filescan, mruFiles } = this[priv];
    return execute(this, async () => {
      for await (let { path: path$1, stats } of filescan(cacheDir)) {
        if (!stats.isFile()) continue
        if (cleanIgnore.test(path.basename(path$1))) continue
        const then = Date.now() - cleanAfter * 1000;
        if (stats.atimeMs < then) {
          path$1 = '/' + path.relative(cacheDir, path$1);
          await uncacheFile(this, path$1);
          this.emit('uncache', path$1);
        }
      }
      mruFiles.clear();
    })
  }
}
function getPrivate ({
  sourceDir,
  cacheDir,
  preloadSiblings,
  preloadFilter,
  preloadRead,
  preloadOpen,
  mruSize = 10,
  fs = realFs
}) {
  return {
    sourceDir,
    cacheDir,
    preloadSiblings,
    preloadFilter: ensureRegex(preloadFilter),
    preloadRead,
    preloadOpen,
    mruSize,
    mruFiles: new Map(),
    openFiles: new Map(),
    lock: new PLock(),
    lstat: util.promisify(fs.lstat),
    readdir: util.promisify(fs.readdir),
    copyFile: util.promisify(fs.copyFile),
    mkdir: util.promisify(fs.mkdir),
    rmdir: util.promisify(fs.rmdir),
    unlink: util.promisify(fs.unlink),
    utimes: util.promisify(fs.utimes),
    filescan: path => filescan({ path, fs })
  }
}
function ensureRegex (rgx) {
  return rgx instanceof RegExp ? rgx : new RegExp(rgx)
}
async function execute (cache, fn) {
  try {
    await cache[priv].lock.exec(fn);
  } catch (err) {
    cache.emit('error', err);
  }
}
async function getFileSize (cache, rec) {
  const { stats } = await cache.locate(rec.path);
  rec.size = stats.size;
}
async function requestCache (cache, reason, path) {
  cache.emit('request', [reason, path]);
  const files = await getSiblings(cache, path);
  for (const sib of files) {
    if (await cacheFile(cache, sib)) {
      cache.emit('cache', sib);
    }
  }
}
async function getSiblings (cache, path$1) {
  const { sourceDir, readdir, preloadSiblings, preloadFilter } = cache[priv];
  let files = await readdir(path.dirname(path.join(sourceDir, path$1)));
  files = files.sort().filter(f => preloadFilter.test(f));
  const ix = files.indexOf(path.basename(path$1));
  return files
    .slice(ix, ix + preloadSiblings + 1)
    .map(f => path.join(path.dirname(path$1), f))
}
async function cacheFile (cache, path$1) {
  const { sourceDir, cacheDir, lstat, utimes, copyFile, mruFiles } = cache[priv];
  const { cached } = await cache.locate(path$1);
  if (cached) return false
  const sourceFile = path.join(sourceDir, path$1);
  const destFile = path.join(cacheDir, path$1);
  await mkdirs(cache, path.dirname(destFile));
  await copyFile(sourceFile, destFile);
  const stats = await lstat(sourceFile);
  await utimes(destFile, stats.atime, stats.mtime);
  mruFiles.delete(path$1);
  return true
}
async function mkdirs (cache, dir) {
  const { mkdir } = cache[priv];
  try {
    await mkdir(dir);
  } catch (err) {
    if (err.code === 'EEXIST') return
    if (err.code !== 'ENOENT') throw err
    await mkdirs(cache, path.dirname(dir));
    return mkdirs(cache, dir)
  }
}
async function uncacheFile (cache, path$1) {
  const { sourceDir, cacheDir, unlink } = cache[priv];
  const fullpath = path.join(cacheDir, path$1);
  const rec = await cache.locate(path$1);
  rec.cached = false;
  rec.fullpath = path.join(sourceDir, path$1);
  await unlink(fullpath);
  await rmdirs(cache, path.dirname(fullpath));
}
async function rmdirs (cache, dir) {
  const { cacheDir, rmdir } = cache[priv];
  if (dir === cacheDir) return
  try {
    await rmdir(dir);
    await rmdirs(cache, path.dirname(dir));
  } catch (err) {
    if (err.code !== 'ENOTEMPTY') throw err
  }
}

function getVfs (options) {
  const cache = new Cache(options);
  options.fs = options.fs || realFs;
  const { fuse, fs } = options;
  const fuseOpts = ['ro'].concat(fuse || []);
  const ffs = new FuseFS(fs, { options: fuseOpts, force: true });
  ffs.before('readdir', onReaddir);
  ffs.before('getattr', 'open', redirectToCacheOrSource);
  ffs.after('open', onOpen);
  ffs.after('read', onRead);
  ffs.after('release', onClose);
  return [ffs, cache]
  async function onReaddir (ctx) {
    const [path] = ctx.args;
    ctx.results = [null, await cache.readdir(path)];
  }
  async function redirectToCacheOrSource (ctx) {
    const [path] = ctx.args;
    const { fullpath } = await cache.locate(path);
    ctx.args[0] = fullpath;
  }
  async function onOpen (ctx) {
    const {
      origArgs: [path],
      results: [err, fd]
    } = ctx;
    if (err) return
    await cache.onOpen(fd, path);
  }
  function onRead ({ args: [fd], results: [bytes] }) {
    if (bytes < 0) return
    cache.onRead(fd, bytes);
  }
  function onClose ({ args: [fd] }) {
    cache.onClose(fd);
  }
}

function NOOP () {}
class Report {
  constructor (options) {
    this.options = options;
    this.level = getLevel(options);
    for (let [msg, msgLevel, fn] of Messages) {
      if (msgLevel > this.level) {
        this[msg] = NOOP;
      } else {
        this[msg] = (...args) => this.log(fn.apply(this, args));
      }
    }
  }
  msg (event, ...args) {
    if (!(event in this)) return
    this[event](...args);
  }
  log (...args) {
    console.log(...args);
  }
  attach (emitter) {
    for (const [msg] of Messages) {
      emitter.on(msg, this[msg].bind(this));
    }
  }
}
function getLevel ({ quiet, verbose }) {
  if (quiet) return 0
  if (typeof verbose === 'number') return verbose
  if (Array.isArray(verbose)) return verbose.length + 1
  return verbose ? 2 : 1
}
const Messages = [
  ['started', 1, () => 'started'],
  ['stopped', 1, () => 'stopped'],
  [
    'heading',
    1,
    function () {
      const { version, sourceDir, cacheDir, mountDir } = this.options;
      return (
        `cachejs v${version}\n` +
        `source : ${sourceDir}\n` +
        `cache  : ${cacheDir}\n` +
        `mount  : ${mountDir}\n`
      )
    }
  ],
  ['cleaning', 2, () => 'cleaning cache'],
  ['error', 0, err => util.format('ERROR %o', err)],
  ['cache', 2, path => `CACHE   ${path}`],
  ['uncache', 2, path => `UNCACHE ${path}`],
  ['hit', 3, path => `HIT     ${path}`],
  ['miss', 3, path => `MISS    ${path}`],
  ['read', 3, path => `READ    ${path}`],
  [
    'request',
    4,
    ([reason, path]) =>
      util.format('%s %s', reason === 'time' ? 'RQ-TIME' : 'RQ-READ', path)
  ]
];

function start (sourceDir, cacheDir, mountDir, options) {
  Object.assign(options, {
    sourceDir,
    cacheDir,
    mountDir,
    version
  });
  const [vfs, cache] = getVfs(options);
  const report = new Report(options);
  report.attach(cache);
  start().catch(err => {
    console.error(err);
    process.exit(1);
  });
  async function start () {
    const { cleanAfter } = options;
    if (cleanAfter) {
      setInterval(nudge, 1000 * cleanAfter).unref();
    }
    report.heading();
    await vfs.mount(mountDir);
    report.started();
    nudge();
    process.on('SIGINT', stop).on('SIGTERM', stop);
    process.on('SIGUSR1', nudge);
  }
  async function stop () {
    await vfs.unmount();
    report.stopped();
  }
  async function nudge () {
    const { cleanIgnore, cleanAfter } = options;
    report.cleaning();
    await cache.clean(cleanIgnore, cleanAfter);
  }
}

const prog = sade('cachejs');
prog.version(version);
prog
  .command(
    'start <src-dir> <cache-dir> <mount-dir>',
    'starts the cacheing server',
    { default: true }
  )
  .option('-V --verbose', 'be more verbose')
  .option('--preload-siblings', 'how many siblings to preload', 3)
  .option('--preload-filter', 'Regex of which files to cache', '^.*\\.flac$')
  .option('--preload-read', 'preload on percetange read', 50)
  .option('--preload-open', 'preload on time open in ms', 2000)
  .option('--clean-after', 'clean after last access in seconds', 6 * 60 * 60)
  .option(
    '--clean-ignore',
    'Regex to ignore when cleaning',
    '^.*[^\\d-](1[-0])?0?1\\.flac$'
  )
  .option('-F --fuse', 'additional fuse options')
  .action(start);
const alias = {
  preloadSiblings: 'preload-siblings',
  preloadFilter: 'preload-filter',
  preloadRead: 'preload-read',
  preloadOpen: 'preload-open',
  cleanAfter: 'clean-after',
  cleanIgnore: 'clean-ignore'
};
prog.parse(process.argv, { alias });
