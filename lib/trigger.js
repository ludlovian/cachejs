'use strict';

module.exports = function trigger() {
  var resolve,
    fireTimeout = null;
  const promise = new Promise(r => { resolve = r; });

  promise.fire = function fire(value) {
    promise.cancel();
    resolve(value);
    return promise;
  };

  promise.fireAfter = function fireAfter(duration, value=true) {
    promise.cancel();

    fireTimeout = setTimeout(() => {
      fireTimeout = null;
      promise.fire(value);
    }, duration);

    return promise;
  };

  promise.cancel = function cancel() {
    if (fireTimeout) {
      clearTimeout(fireTimeout);
      fireTimeout = null;
    }

    return promise;
  };

  return promise;
};

