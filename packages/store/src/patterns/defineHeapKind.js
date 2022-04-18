import { makeScalarWeakMapStore } from '../stores/scalarWeakMapStore.js';
import { defendVTable } from './interface-tools.js';

const { create } = Object;

export const defineHeapKind = (
  iface,
  init,
  rawVTable,
  { finish = undefined } = {},
) => {
  const { klass } = iface;
  assert(klass === 'Interface');
  const contextMapStore = makeScalarWeakMapStore();
  const defensiveVTable = defendVTable(rawVTable, contextMapStore, iface);
  const makeInstance = (...args) => {
    const state = init(...args);
    const self = create(defensiveVTable);
    const context = harden({ state, self });
    contextMapStore.init(self, context);
    if (finish) {
      finish(context);
    }
    return self;
  };
  return harden(makeInstance);
};
harden(defineHeapKind);
