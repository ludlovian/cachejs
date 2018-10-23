const tap = require('tap')
const sinon = require('sinon')
const delay = require('util').promisify(setTimeout)

function unused () {}

tap.test('worker', async t => {
  t.afterEach(async () => sinon.restore())

  const log = require('../lib/log')
  const worker = require('../lib/worker')

  t.test('pushing a function', async t => {
    const fn = () => delay(1).then(() => 'bar')

    const p = worker.push('foo', fn)
    t.type(p, Promise, 'push returns a promise')

    const res = await p
    t.same(res, 'bar', 'promise resolves')
  })

  t.test('pushing too many functions', async t => {
    const limit = require('config').get('queueLimit')
    const logWarn = sinon.fake()
    sinon.replace(log, 'warn', logWarn)

    const res = []
    const proms = []

    Array(limit).fill().forEach((_, i) => {
      unused(_)

      const fn = () => delay(1).then(() => res.push(`bar ${i}`))
      const prom = worker.push(`foo ${i}`, fn)
      proms.push(prom)
    })

    logWarn.resetHistory()

    // should now be full, so lets add an extra one
    const lastF = () => delay(1).then(() => res.push('bar last'))
    const lastP = worker.push('foo last', lastF)
    proms.push(lastP)

    t.match(logWarn.args, [
      [ /Skipping/, 'foo last' ]
    ], 'warning issued')

    // now wait for the queue to finish
    await Promise.all(proms)

    t.equal(res.length, limit, 'extra work should be ignored')
    res.forEach((v, i) => {
      t.equal(v, `bar ${i}`, `work item ${i} ok`)
    })
  })

  t.test('work item that fails', async t => {
    const logWarn = sinon.fake()
    const err = new Error('quux')
    const fn = () => delay(1).then(() => Promise.reject(err))

    sinon.replace(log, 'warn', logWarn)

    const prom = worker.push('foo', fn)

    await prom

    t.same(logWarn.callCount, 2, 'two warning lines produced')
    t.match(logWarn.args, [
      [ 'Work item failed: %s', 'foo' ],
      [ 'Error: %s', err ]
    ], 'right warnings produced')
  })

  t.test('stopping the worker', async t => {
    const res = []
    worker.push('foo 1', () => delay(1).then(() => res.push('bar 1')))
    worker.push('foo 2', () => delay(1).then(() => res.push('bar 2')))

    // now stop the worker
    await worker.stop()

    t.strictSame(res, [ 'bar 1' ], 'rest of queue discarded')
  })
})
