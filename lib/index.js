
'use strict';

/*
* Requires & promisifieds
*/


const
  UnionFS = require('unionfs'),

  config = require('./config'),
  events = require('./events'),
  worker = require('./worker'),
  log = require('./log'),
  { fatalError } = require('./util'),
  { startCleaner, stopCleaner, requestCleanup } = require('./cleanup'),

  Debug = require('debug'),
  debug = Debug('cachejs:index');


var fs = null;

async function start() {

  await config.load();

  logHeader();

  fs = new UnionFS(
    [config.dirs.cache, config.dirs.source],
    {
      options: config.fuseOptions,
      force: true,
    }
  );
  fs.on('open', events.onOpen);
  fs.on('close', events.onClose);
  fs.on('read', events.onRead);
  fs.on('error', fatalError);

  debug('mounting %s', config.dirs.mount);
  await fs.mount(config.dirs.mount.toString());

  startCleaner();
}

function logHeader() {
  log(1, `cachejs v${config.version}`);
  log(1, `source  ${config.dirs.source}`);
  log(1, `cache   ${config.dirs.cache}`);
  log(1, `mount   ${config.dirs.mount}`);
}

async function stop(keepAlive) {

  stopCleaner();

  await worker.idle();

  debug('unmounting %s', config.dirs.mount);
  // istanbul ignore else
  if (fs) {
    await fs.umount();
  }
  fs = null;
  // istanbul ignore if
  if (!keepAlive) {
    bye();
  }
}

// istanbul ignore next
function requestStop() {
  stop().catch(fatalError);
}

// istanbul ignore next
function bye() {
  log(1, '\nEnded.');
  process.nextTick(() => process.exit(0));
}

async function reload() {
  log(1, 'HUP receiveed. Reloading');
  stopCleaner();
  await config.reload();

  logHeader();
  requestCleanup();
}
// istanbul ignore next

// istanbul ignore if
if (require.main === module) {
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  process.on('SIGHUP', reload);

  start()
    .then(requestCleanup)
    .catch(fatalError);
} else {
  // export for testing
  module.exports = { start, stop, reload, requestCleanup };
}
