'use strict';

const trigger = require('../lib/trigger'),
  delay = require('util').promisify(setTimeout),
  tap = require('tap'),
  test = tap.test;

test('create trigger', async t => {
  const trg = trigger();

  t.type(trg, Promise, 'it is a promise');
  t.type(trg.fire, 'function', '.fire is a function');
  t.type(trg.fireAfter, 'function', '.fireAfter is a function');
  t.type(trg.cancel, 'function', '.cancel is a function');
});

test('firing with a value', async t => {
  const result = {
      resolved: false,
      value: null,
    },

    trg = trigger(),

    cleanup = trg.then(v => {
      result.resolved = true;
      result.value = v;
    });

  t.match(result, {resolved: false}, 'starts unresolved');

  const fireReturn = trg.fire(17);
  t.strictEqual(fireReturn, trg, 'fire returns the promise');

  await cleanup;
  t.match(result, { resolved: true, value: 17 }, 'promise resolved correctly');

  const v2 = await trg.fire('another');
  t.equal(v2, 17, 'second firing makes no difference');

  const v3 = await trg.cancel();
  t.equal(v3, 17, 'cancel makes no difference');
});

test('fire after timeout', async t => {
  const result = {
      resolved: false,
      value: null,
    },

    trg = trigger(),

    cleanup = trg.then(v => {
      result.resolved = true;
      result.value = v;
    });

  const fireAfterReturn = trg.fireAfter(100,'val');
  t.strictEqual(fireAfterReturn, trg, 'fireAfter returns the promise');

  await delay(50);
  t.match(result, { resolved: false }, 'not fired after 50ms');

  await delay(100);
  t.match(result, { resolved: true, value: 'val' }, 'fired after 150ms');

  await cleanup;
});

test('cancel a timeout', async t => {
  const result = {
      resolved: false,
      value: null,
    },

    trg = trigger(),

    cleanup = trg.then(v => {
      result.resolved = true;
      result.value = v;
    });

  trg.fireAfter(100, 111);
  await delay(50);

  t.match(result, { resolved: false }, 'not yet fired');
  const cancelReturn = trg.cancel();
  t.strictEqual(cancelReturn, trg, 'cancel returns trigger');

  await delay(100);
  t.match(result, { resolved: false }, 'still not fired');

  trg.fireAfter(50);
  await cleanup;
  t.match(result, { resolved: true, value: true}, 'second fireAfter worked default value');

});

