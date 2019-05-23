'use strict'

import sade from 'sade'
import { version } from '../package.json'
import start from './start'

const prog = sade('cachejs')

prog.version(version)

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
  .action(start)

const alias = {
  preloadSiblings: 'preload-siblings',
  preloadFilter: 'preload-filter',
  preloadRead: 'preload-read',
  preloadOpen: 'preload-open',
  cleanAfter: 'clean-after',
  cleanIgnore: 'clean-ignore'
}

prog.parse(process.argv, { alias })
