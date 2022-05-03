// @ts-check
// XXX must be first
import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { setupZCFTest } from '@agoric/zoe/test/unitTests/zcf/setupZcfTest.js';
import { Far } from '@endo/marshal';
import { makeVaultManager } from '../../src/vaultFactory/vaultManager.js';

// TODO test updates
test('notifier initial states', async t => {
  const collatosKit = makeIssuerKit('collatos');
  const terms = harden({
    governedParams: {},
  });

  const issuerKeywordRecord = harden({
    Collateral: Promise.resolve(collatosKit.issuer),
  });

  const { feeMintAccess, zcf } = await setupZCFTest(issuerKeywordRecord, terms);
  const debtMint = await zcf.registerFeeMint('Debt', feeMintAccess);
  const debtBrand = debtMint.getIssuerRecord().brand;

  /** @type {ERef<PriceAuthority>}} */
  // @ts-expect-error cast
  const priceAuthority = harden({});

  /** @type {import('../../src/vaultFactory/vaultDirector.js').FactoryPowersFacet} */
  // @ts-expect-error cast
  const factoryPowers = Far('fake vault factory powers', {
    getGovernedParams: () => ({
      getChargingPeriod: () => 404n, // FIXME
      getInterestRate: () => makeRatio(1n, debtBrand),
    }),
  });
  /** @type {ERef<TimerService>} */
  // @ts-expect-error
  const timerService = harden({});
  /** @type {ZCFSeat} */
  // @ts-expect-error
  const penaltyPoolSeat = harden({});
  const startTimeStamp = 0n;

  const manager = makeVaultManager(
    zcf,
    debtMint,
    collatosKit.brand,
    priceAuthority,
    factoryPowers,
    timerService,
    penaltyPoolSeat,
    startTimeStamp,
  );
  const publicFacet = manager.getPublicFacet();

  const assetNotifier = publicFacet.getAssetNotifier();
  const assetState = await assetNotifier.getUpdateSince();
  t.deepEqual(assetState.value, {
    compoundedInterest: makeRatio(100n, debtBrand),
    interestRate: makeRatio(1n, debtBrand),
    latestInterestUpdate: 0n,
  });

  const econNotifier = publicFacet.getEconNotifier();
  const econState = await econNotifier.getUpdateSince();
  t.deepEqual(econState.value, {
    totalCollateral: AmountMath.makeEmpty(collatosKit.brand),
    totalDebt: AmountMath.makeEmpty(debtBrand),
  });
});
