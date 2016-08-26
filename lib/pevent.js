/*
 * pevent
 *
 * Simple promise-based event controller
 *
 * Key differences from native events:
 *
 * Events are drivestored with a two-part key
 * - object
 * - event name
 *
 * Event actions are Promise-based
 *
 * API
 *
 *  on(object, event, callback)
 *  emit(object, event) -> promise of completion
 *  clear(object, [event])
 */

/* jshint strict:global, esversion:6, node:true, laxcomma:true, laxbreak:true */

'use strict';

/*
 * Requires & promisifieds
 */

var debug = require('debug')('cachejs:pevent')
  , Promise = require('pixpromise')
  ;

var objectMap = new Map();


exports.on = function on(object, event, callback) {
    debug('setting pevent for %s %s', object, event);
    var callbacks = getCallbacksFor(object, event);
    callbacks.push(callback);
};

exports.emit = /*Promise*/ function emit(object, event) {
    debug('firing pevent for %s %s', object, event);
    return Promise.resolve(getCallbacksFor(object, event))
    .mapSeries(f => f())
    .tap(() => debug('event finished'));
};

exports.clear = function clear(object, event) {
    debug('clearing pevent for %s %s', object, event);
    object = object.toString();

    var eventMap = objectMap.get(object);
    if (!eventMap)
        return; // nothing to clear

    if (!event) {
        // clear the whole object
        objectMap.delete(object);
        return;
    }

    event = event.toString();
    eventMap.delete(event);
};

function getCallbacksFor(object, event, callback) {
    object = object.toString();
    event = event.toString();

    var eventMap = objectMap.get(object);
    if (!eventMap) {
        eventMap = new Map();
        objectMap.set(object, eventMap);
    }

    var callbacks = eventMap.get(event);
    if (!callbacks) {
        callbacks = [];
        eventMap.set(event, callbacks);
    }

    return callbacks;
}




