'use strict';

const PathScan = require('pathscan'),
  { promisify } = require('util'),
  fs = require('fs'),
  stat = promisify(fs.stat),

  config = require('./config'),
  worker = require('./worker'),
  log = require('./log'),
  
  { de, bug } = require('./debug')('cleanup');

var nextCleanupTimer = null;

function startCleaner() {
  // istanbul ignore if
  if (nextCleanupTimer) {
    return;
  }

  nextCleanupTimer = setTimeout(
    requestCleanup,
    config.cleanup.cleanFrequency * 1000
  );
}

function stopCleaner() {
  // istanbul ignore else
  if (nextCleanupTimer) {
    clearTimeout(nextCleanupTimer);
    nextCleanupTimer = null;
  }
}

function requestCleanup() {
  stopCleaner();
  worker.push('cleanup', cleanup);
}

async function cleanup() {
  de&&bug('cleaning up');

  const cutoff = Date.now() - (config.cleanup.cleanAfter * 1000);

  const files = await findCacheFiles();

  const filesWithStats = await Promise.all(
    files.map(async file => {
      const stats = await stat(file.path);
      return { file, stats };
    })
  );

  const filesToClean = filesWithStats
    .filter(obj => obj.stats.atime.valueOf() < cutoff)
    .map(obj => obj.file);

  de&&bug('files to clean: %o', filesToClean);

  if (filesToClean.length) {
    await Promise.all(filesToClean.map(cleanupFile));

    await removeEmptyDirs();
  }

  startCleaner();
}

async function findCacheFiles() {

  const ignoreFilter = new RegExp(config.cleanup.ignoreFilter);

  const scan = new PathScan(config.dirs.cache, {collect:true});
  await scan.wait();

  return scan.files
    .filter(file => file.meta.type === 'file')
    .filter(file => !ignoreFilter.test(file.name()))
    .sort();
}

async function cleanupFile(file) {
  log(2, `UNCACHE ${file.path}`);
  return file.unlink();
}

async function removeEmptyDirs() {
  const scan = new PathScan(config.dirs.cache, {collect:true});
  await scan.wait();

  const dirs = scan.files
    .filter(p => p.meta.type === 'dir')
    .sort()
    .reverse();

  dirs.pop(); // remove the cache dir itself
  de&&bug('dirs=%o', dirs);

  for(let dir of dirs) {
    await dir.rmdir({allowFail: true});
  }
}

module.exports = {
  startCleaner,
  stopCleaner,
  requestCleanup,
};
