// @ts-check

// no-lonely-if is a stupid rule that really should be disabled globally
/* eslint-disable no-lonely-if */

import { assert } from '@agoric/assert';
import { M } from '@agoric/store';
import { parseVatSlot } from '../lib/parseVatSlots.js';

export function makeWatchedPromiseManager(
  syscall,
  vrm,
  vom,
  cm,
  convertValToSlot,
  convertSlotToVal,
  revivePromise,
) {
  const { makeScalarBigMapStore } = cm;
  const { defineDurableKind } = vom;

  // watched promises by vpid: each entry is an array of watches on the
  // corresponding vpid; each of these is in turn an array of a watcher object
  // and the arguments associated with it by `watchPromise`.
  let watchedPromiseTable;

  // defined promise watcher objects indexed by kindHandle
  let promiseWatcherByKindTable;

  function preparePromiseWatcherTables() {
    let watcherTableID = syscall.vatstoreGet('watcherTableID');
    if (watcherTableID) {
      promiseWatcherByKindTable = convertSlotToVal(watcherTableID);
    } else {
      promiseWatcherByKindTable = makeScalarBigMapStore(
        'promiseWatcherByKind',
        { durable: true },
      );
      watcherTableID = convertValToSlot(promiseWatcherByKindTable);
      syscall.vatstoreSet('watcherTableID', watcherTableID);
      // artificially increment the table's refcount so it never gets GC'd
      vrm.addReachableVref(watcherTableID);
    }

    let watchedPromiseTableID = syscall.vatstoreGet('watchedPromiseTableID');
    if (watchedPromiseTableID) {
      watchedPromiseTable = convertSlotToVal(watchedPromiseTableID);
    } else {
      watchedPromiseTable = makeScalarBigMapStore('watchedPromises', {
        keySchema: M.string(), // key is always a vpid
        durable: true,
      });
      watchedPromiseTableID = convertValToSlot(watchedPromiseTable);
      syscall.vatstoreSet('watchedPromiseTableID', watchedPromiseTableID);
      // artificially increment the table's refcount so it never gets GC'd
      vrm.addReachableVref(watchedPromiseTableID);
    }
  }

  function pseudoThen(p, vpid) {
    function settle(value, wasFulfilled) {
      const watches = watchedPromiseTable.get(vpid);
      watchedPromiseTable.delete(vpid);
      for (const watch of watches) {
        const [watcher, ...args] = watch;
        Promise.resolve().then(() => {
          if (wasFulfilled) {
            if (watcher.onFulfilled) {
              watcher.onFulfilled(value, ...args);
            }
          } else {
            if (watcher.onRejected) {
              watcher.onRejected(value, ...args);
            } else {
              throw value; // for host's unhandled rejection handler to catch
            }
          }
        });
      }
    }

    p.then(
      res => settle(res, true),
      rej => settle(rej, false),
    );
  }

  const VatUpgradedMessage = 'vat upgraded'; // part of the SwingSet API

  function loadWatchedPromiseTable() {
    const deadPromisesRaw = syscall.vatstoreGet('deadPromises') || '';
    syscall.vatstoreDelete('deadPromises');
    const deadPromises = new Set(deadPromisesRaw.split(','));

    for (const [vpid, watches] of watchedPromiseTable.entries()) {
      if (deadPromises.has(vpid)) {
        watchedPromiseTable.delete(vpid);
        for (const watch of watches) {
          const [watcher, ...args] = watch;
          Promise.resolve().then(() => {
            if (watcher.onRejected) {
              watcher.onRejected(VatUpgradedMessage, ...args);
            } else {
              // eslint-disable-next-line no-throw-literal
              throw VatUpgradedMessage;
            }
          });
        }
      } else {
        const p = revivePromise(vpid);
        pseudoThen(p, vpid);
      }
    }
  }

  function providePromiseWatcher(
    kindHandle,
    fulfillHandler = x => x,
    rejectHandler = x => {
      throw x;
    },
  ) {
    assert.typeof(fulfillHandler, 'function');
    assert.typeof(rejectHandler, 'function');

    const makeWatcher = defineDurableKind(kindHandle, () => ({}), {
      // @ts-expect-error  TS is confused by the spread operator
      onFulfilled: (_context, res, ...args) => fulfillHandler(res, ...args),
      // @ts-expect-error
      onRejected: (_context, rej, ...args) => rejectHandler(rej, ...args),
    });

    if (promiseWatcherByKindTable.has(kindHandle)) {
      return promiseWatcherByKindTable.get(kindHandle);
    } else {
      const watcher = makeWatcher();
      promiseWatcherByKindTable.init(kindHandle, watcher);
      return watcher;
    }
  }

  function watchPromise(p, watcher, ...args) {
    // The following wrapping defers setting up the promise watcher itself to a
    // later turn so that if the promise to be watched was the return value from
    // a preceding eventual message send, then the assignment of a vpid to that
    // promise, which happens in a turn after the initiation of the send, will
    // have happened by the time the code below executes, and thus when we call
    // `convertValToSlot` on the promise here we'll get back the vpid that was
    // assigned rather than generating a new one that nobody knows about.
    Promise.resolve().then(() => {
      const watcherVref = convertValToSlot(watcher);
      assert(watcherVref, 'invalid watcher');
      const { virtual } = parseVatSlot(watcherVref);
      assert(virtual, 'promise watcher must be a virtual object');
      if (watcher.onFulfilled) {
        assert.typeof(watcher.onFulfilled, 'function');
      }
      if (watcher.onRejected) {
        assert.typeof(watcher.onRejected, 'function');
      }
      assert(
        watcher.onFulfilled || watcher.onRejected,
        'promise watcher must implement at least one handler method',
      );

      const vpid = convertValToSlot(p);
      assert(vpid, 'invalid promise');
      const { type } = parseVatSlot(vpid);
      assert(type === 'promise', 'watchPromise only watches promises');
      if (watchedPromiseTable.has(vpid)) {
        const watches = watchedPromiseTable.get(vpid);
        watchedPromiseTable.set(vpid, harden([...watches, [watcher, ...args]]));
      } else {
        watchedPromiseTable.init(vpid, harden([[watcher, ...args]]));
        pseudoThen(p, vpid);
      }
    });
  }

  function prepareShutdownRejections(deciderVPIDs) {
    const deadPromises = [];
    for (const vpid of deciderVPIDs) {
      if (watchedPromiseTable.has(vpid)) {
        deadPromises.push(vpid);
      }
    }
    syscall.vatstoreSet('deadPromises', deadPromises.join(','));
  }

  return harden({
    preparePromiseWatcherTables,
    loadWatchedPromiseTable,
    providePromiseWatcher,
    watchPromise,
    prepareShutdownRejections,
  });
}
