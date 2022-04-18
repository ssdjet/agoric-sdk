// @ts-check

import { test } from '@agoric/swingset-vat/tools/prepare-test-env-ava.js';
import { passStyleOf } from '@endo/marshal';

import { I } from '../src/patterns/interface-tools.js';
import { defineHeapKind } from '../src/patterns/defineHeapKind.js';
import { M } from '../src/patterns/patternMatchers.js';

test('how far-able is defineHeapKind', t => {
  const bobIFace = I.interface('bob', {
    foo: I.call(M.any()).returns(M.undefined()),
  });
  const makeBob = defineHeapKind(bobIFace, () => ({}), {
    // @ts-ignore
    foo: ({ _state, _self }, _carol) => console.log('got here'),
  });
  const bob = makeBob();
  t.assert(passStyleOf(bob) === 'remotable');
});
