import { PASS_STYLE } from '@endo/marshal';
import { E } from '@endo/eventual-send';
import { M, fit } from './patternMatchers.js';

const { details: X, quote: q } = assert;
const { apply, ownKeys } = Reflect;
const { fromEntries, entries, defineProperties } = Object;

const makeMethodGuardMaker = (callKind, argGuards) =>
  harden({
    returns: (returnGuard = M.any()) =>
      harden({
        klass: 'methodGuard',
        callKind,
        argGuards,
        returnGuard,
      }),
  });

const makeAwaitArgGuard = argGuard =>
  harden({
    klass: 'awaitArg',
    argGuard,
  });

const isAwaitArgGuard = argGuard =>
  argGuard && typeof argGuard === 'object' && argGuard.klass === 'awaitArg';

export const I = harden({
  interface: (name, methodGuards) => {
    for (const [_, methodGuard] of entries(methodGuards)) {
      assert(
        methodGuard.klass === 'methodGuard',
        X`unrecognize method guard ${methodGuard}`,
      );
    }
    return harden({
      klass: 'Interface',
      name,
      methodGuards,
    });
  },
  call: (...argGuards) => makeMethodGuardMaker('sync', argGuards),
  callWhen: (...argGuards) => makeMethodGuardMaker('async', argGuards),
  apply: argGuards => makeMethodGuardMaker('sync', argGuards),
  applyWhen: argGuards => makeMethodGuardMaker('async', argGuards),

  await: argGuard => makeAwaitArgGuard(argGuard),
});

const defendSyncMethod = (rawMethod, contextMapStore, methodGuard) => {
  const { argGuards, returnGuard } = methodGuard;

  const defensiveSyncMethod = (...args) => {
    // Note purposeful use of `this`
    assert(
      contextMapStore.has(this),
      X`method can only be used on its own instances: ${rawMethod}`,
    );
    const context = contextMapStore.get(this);
    fit(args, argGuards);
    const result = apply(rawMethod, undefined, [context, ...args]);
    fit(result, returnGuard);
    return result;
  };
  return harden(defensiveSyncMethod);
};

const defendAsyncMethod = (rawMethod, contextMapStore, methodGuard) => {
  const { argGuards, returnGuard } = methodGuard;

  const rawArgGuards = [];
  const awaitIndexes = [];
  for (let i = 0; i < argGuards.length; i += 1) {
    const argGuard = argGuards[i];
    if (isAwaitArgGuard(argGuard)) {
      rawArgGuards.push(argGuard.argGuard);
      awaitIndexes.push(i);
    } else {
      rawArgGuards.push(argGuard);
    }
  }
  harden(rawArgGuards);
  harden(awaitIndexes);
  const defensiveAsyncMethod = (...args) => {
    // Note purposeful use of `this`
    assert(
      contextMapStore.has(this),
      X`method can only be used on its own instances: ${rawMethod}`,
    );
    const context = contextMapStore.get(this);
    const awaitList = awaitIndexes.map(i => args[i]);
    const p = Promise.all(awaitList);
    const rawArgs = [...args];
    return E.when(p, awaitedArgs => {
      for (let j = 0; j < awaitIndexes.length; j += 1) {
        rawArgs[awaitIndexes[j]] = awaitedArgs[j];
      }
      fit(rawArgs, rawArgGuards);
      const resultP = apply(rawMethod, undefined, [context, ...rawArgs]);
      return E.when(resultP, result => {
        fit(result, returnGuard);
        return result;
      });
    });
  };
  return harden(defensiveAsyncMethod);
};

const defendMethod = (rawMethod, contextMapStore, methodGuard) => {
  const { klass, callKind } = methodGuard;
  assert(klass === 'methodGuard');

  if (callKind === 'sync') {
    return defendSyncMethod(rawMethod, contextMapStore, methodGuard);
  } else {
    assert(callKind === 'async');
    return defendAsyncMethod(rawMethod, contextMapStore, methodGuard);
  }
};

const defaultMethodGuard = I.apply(M.array()).returns();

export const defendVTable = (rawVTable, contextMapStore, iface) => {
  const { klass, name, methodGuards } = iface;
  assert(klass === 'Interface');
  assert.typeof(name, 'string');

  const methodGuardNames = ownKeys(methodGuards);
  for (const methodGuardName of methodGuardNames) {
    assert(
      methodGuardName in rawVTable,
      X`${q(methodGuardName)} not implemented by ${rawVTable}`,
    );
  }
  const methodNames = ownKeys(rawVTable);
  // like Object.entries, but unenumerable and symbol as well.
  const rawMethodEntries = methodNames.map(mName => [mName, rawVTable[mName]]);
  const defensiveMethodEntries = rawMethodEntries.map(([mName, rawMethod]) => {
    const methodGuard = methodGuards[mName] || defaultMethodGuard;
    const defensiveMethod = defendMethod(
      rawMethod,
      contextMapStore,
      methodGuard,
    );
    return [mName, defensiveMethod];
  });
  // Return the defensive VTable, which can be use on a shared
  // prototype and shared by instances, avoiding the per-object-per-method
  // allocation cost of the objects as closure pattern. That's why we
  // use `this` above. To make it safe, each defensive method starts with
  // a fail-fast brand check on `this`, ensuring that the methods can only be
  // applied to legitimate instances.
  const defensiveVTable = fromEntries(defensiveMethodEntries);
  defineProperties(defensiveVTable, {
    [PASS_STYLE]: { value: 'remotable' },
    [Symbol.toStringTag]: { value: name },
  });
  return harden(defensiveVTable);
};
harden(defendVTable);
