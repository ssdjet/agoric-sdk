// @ts-nocheck

import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
import '@agoric/zoe/exported.js';

import { E } from '@endo/eventual-send';
import { deeplyFulfilled } from '@endo/marshal';

import { makeIssuerKit, AssetKind, AmountMath } from '@agoric/ertp';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import {
  makeRatio,
  makeRatioFromAmounts,
  ceilMultiplyBy,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';

import { makeTracer } from '../../src/makeTracer.js';
import {
  startEconomicCommittee,
  startVaultFactory,
  setupAmm,
} from '../../src/econ-behaviors.js';
import '../../src/vaultFactory/types.js';
import * as Collect from '../../src/collect.js';

import {
  makeVoterTool,
  setUpZoeForTest,
  setupBootstrap,
  installGovernance,
  waitForPromisesToSettle,
} from '../supports.js';
import { unsafeMakeBundleCache } from '../bundleTool.js';

// #region Support

// TODO path resolve these so refactors detect
const contractRoots = {
  faucet: './test/vaultFactory/faucet.js',
  liquidate: './src/vaultFactory/liquidateIncrementally.js',
  VaultFactory: './src/vaultFactory/vaultFactory.js',
  amm: './src/vpool-xyk-amm/multipoolMarketMaker.js',
};

/** @typedef {import('../../src/vaultFactory/vaultFactory').VaultFactoryContract} VFC */

const trace = makeTracer('TestST');

const BASIS_POINTS = 10000n;

// Define locally to test that vaultFactory uses these values
export const Phase = /** @type {const} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
  TRANSFER: 'transfer',
});

/**
 * dL: 1M, lM: 105%, lP: 10%, iR: 100, lF: 500
 *
 * @param {Brand} debtBrand
 */
function defaultParamValues(debtBrand) {
  return harden({
    debtLimit: AmountMath.make(debtBrand, 1_000_000n),
    // margin required to maintain a loan
    liquidationMargin: makeRatio(105n, debtBrand),
    // penalty upon liquidation as proportion of debt
    liquidationPenalty: makeRatio(10n, debtBrand),
    // periodic interest rate (per charging period)
    interestRate: makeRatio(100n, debtBrand, BASIS_POINTS),
    // charge to create or increase loan balance
    loanFee: makeRatio(500n, debtBrand, BASIS_POINTS),
  });
}

test.before(async t => {
  const { zoe, feeMintAccess } = setUpZoeForTest();
  const runIssuer = E(zoe).getFeeIssuer();
  const runBrand = await E(runIssuer).getBrand();
  const aethKit = makeIssuerKit('aEth');
  const loader = await unsafeMakeBundleCache('./bundles/'); // package-relative

  // note that the liquidation might be a different bundle name
  // Collect.mapValues(contractRoots, (root, k) => loader.load(root, k)),
  const bundles = await Collect.allValues({
    faucet: loader.load(contractRoots.faucet, 'faucet'),
    liquidate: loader.load(contractRoots.liquidate, 'liquidateIncrementally'),
    VaultFactory: loader.load(contractRoots.VaultFactory, 'VaultFactory'),
    amm: loader.load(contractRoots.amm, 'amm'),
  });
  const installation = Collect.mapValues(bundles, bundle =>
    E(zoe).install(bundle),
  );
  const contextPs = {
    bundles,
    installation,
    zoe,
    feeMintAccess,
    aethKit,
    runKit: { issuer: runIssuer, brand: runBrand },
    loanTiming: {
      chargingPeriod: 2n,
      recordingPeriod: 6n,
    },
    rates: defaultParamValues(runBrand),
    runInitialLiquidity: AmountMath.make(runBrand, 1_500_000_000n),
    aethInitialLiquidity: AmountMath.make(aethKit.brand, 900_000_000n),
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = { ...frozenCtx };
  trace(t, 'CONTEXT');
});

const setupAmmAndElectorate = async (t, aethLiquidity, runLiquidity) => {
  const {
    zoe,
    aethKit: { issuer: aethIssuer },
    electorateTerms,
    timer,
  } = t.context;

  const space = setupBootstrap(t, timer);
  const { consume, instance } = space;
  installGovernance(zoe, space.installation.produce);
  space.installation.produce.amm.resolve(t.context.installation.amm);
  startEconomicCommittee(space, electorateTerms);
  setupAmm(space);

  const governorCreatorFacet = consume.ammGovernorCreatorFacet;
  const governorInstance = await instance.consume.ammGovernor;
  const governorPublicFacet = await E(zoe).getPublicFacet(governorInstance);
  const governedInstance = E(governorPublicFacet).getGovernedContract();

  const counter = await space.installation.consume.binaryVoteCounter;
  t.context.committee = makeVoterTool(
    zoe,
    space.consume.economicCommitteeCreatorFacet,
    // @ts-expect-error TODO: add vaultFactoryGovernorCreator to vats/src/types.js
    space.consume.vaultFactoryGovernorCreator,
    counter,
  );

  /** @type { GovernedPublicFacet<XYKAMMPublicFacet> } */
  // @ts-expect-error cast from unknown
  const ammPublicFacet = await E(governorCreatorFacet).getPublicFacet();

  const liquidityIssuer = E(ammPublicFacet).addPool(aethIssuer, 'Aeth');
  const liquidityBrand = await E(liquidityIssuer).getBrand();

  const liqProposal = harden({
    give: {
      Secondary: aethLiquidity.proposal,
      Central: runLiquidity.proposal,
    },
    want: { Liquidity: AmountMath.makeEmpty(liquidityBrand) },
  });
  const liqInvitation = await E(ammPublicFacet).makeAddLiquidityInvitation();

  const ammLiquiditySeat = await E(zoe).offer(
    liqInvitation,
    liqProposal,
    harden({
      Secondary: aethLiquidity.payment,
      Central: runLiquidity.payment,
    }),
  );

  // TODO get the creator directly
  const newAmm = {
    ammCreatorFacet: await consume.ammCreatorFacet,
    ammPublicFacet,
    instance: governedInstance,
    ammLiquidity: E(ammLiquiditySeat).getPayout('Liquidity'),
  };

  return { amm: newAmm, space };
};

/**
 *
 * @param {ExecutionContext} t
 * @param {bigint} runInitialLiquidity
 */
const getRunFromFaucet = async (t, runInitialLiquidity) => {
  const {
    installation: { faucet: installation },
    zoe,
    feeMintAccess,
  } = t.context;
  /** @type {Promise<Installation<import('./faucet.js').start>>} */
  // @ts-expect-error cast
  // On-chain, there will be pre-existing RUN. The faucet replicates that
  const { creatorFacet: faucetCreator } = await E(zoe).startInstance(
    installation,
    {},
    {},
    harden({ feeMintAccess }),
  );
  const faucetSeat = E(zoe).offer(
    await E(faucetCreator).makeFaucetInvitation(),
    harden({
      give: {},
      want: { RUN: runInitialLiquidity },
    }),
  );

  const runPayment = await E(faucetSeat).getPayout('RUN');
  return runPayment;
};

/**
 * NOTE: called separately by each test so AMM/zoe/priceAuthority don't interfere
 *
 * @param {ExecutionContext} t
 * @param {Amount} initialPrice
 * @param {Amount} priceBase
 * @param {TimerService} timer
 */
async function setupServices(
  t,
  initialPrice,
  priceBase,
  timer = buildManualTimer(t.log),
) {
  const {
    zoe,
    runKit: { issuer: runIssuer, brand: runBrand },
    aethKit: { brand: aethBrand, issuer: aethIssuer, mint: aethMint },
    loanTiming,
    rates,
    aethInitialLiquidity,
    runInitialLiquidity,
  } = t.context;
  t.context.timer = timer;

  const runPayment = await getRunFromFaucet(t, runInitialLiquidity);
  trace(t, 'faucet', { runInitialLiquidity, runPayment });
  const runLiquidity = {
    proposal: runInitialLiquidity,
    payment: runPayment,
  };
  const aethLiquidity = {
    proposal: aethInitialLiquidity,
    payment: aethMint.mintPayment(aethInitialLiquidity),
  };
  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    t,
    aethLiquidity,
    runLiquidity,
  );
  const { consume, produce } = space;
  trace(t, 'amm', { ammFacets });

  const quoteMint = makeIssuerKit('quote', AssetKind.SET).mint;
  // Cheesy hack for easy use of manual price authority
  const priceAuthority = makeManualPriceAuthority({
    actualBrandIn: aethBrand,
    actualBrandOut: runBrand,
    initialPrice: makeRatioFromAmounts(initialPrice, priceBase),
    timer,
    quoteMint,
  });
  produce.priceAuthority.resolve(priceAuthority);

  const {
    installation: { produce: iProduce },
  } = space;
  iProduce.VaultFactory.resolve(t.context.installation.VaultFactory);
  iProduce.liquidate.resolve(t.context.installation.liquidate);
  await startVaultFactory(space, { loanParams: loanTiming });

  const governorCreatorFacet = consume.vaultFactoryGovernorCreator;
  /** @type {Promise<VaultFactory & LimitedCreatorFacet<any>>} */
  const vaultFactoryCreatorFacet = /** @type { any } */ (
    E(governorCreatorFacet).getCreatorFacet()
  );

  // Add a vault that will lend on aeth collateral
  const aethVaultManagerP = E(vaultFactoryCreatorFacet).addVaultType(
    aethIssuer,
    'AEth',
    rates,
  );

  /** @type {[any, VaultFactory, VFC['publicFacet']]} */
  // @ts-expect-error cast
  const [governorInstance, vaultFactory, lender, aethVaultManager] =
    await Promise.all([
      E(consume.agoricNames).lookup('instance', 'VaultFactoryGovernor'),
      vaultFactoryCreatorFacet,
      E(governorCreatorFacet).getPublicFacet(),
      aethVaultManagerP,
    ]);
  trace(t, 'pa', { governorInstance, vaultFactory, lender, priceAuthority });

  const { g, v } = {
    g: {
      governorInstance,
      governorPublicFacet: E(zoe).getPublicFacet(governorInstance),
      governorCreatorFacet,
    },
    v: {
      vaultFactory,
      lender,
      aethVaultManager,
    },
  };

  return {
    zoe,
    // installs,
    governor: g,
    vaultFactory: v,
    ammFacets,
    runKit: { issuer: runIssuer, brand: runBrand },
    priceAuthority,
  };
}
// #endregion

// #region driver
const makeDriver = async (t, initialPrice, priceBase) => {
  const timer = buildManualTimer(t.log);
  const services = await setupServices(t, initialPrice, priceBase, timer);

  const {
    zoe,
    aethKit: { mint: aethMint, issuer: aethIssuer, brand: aethBrand },
    runKit: { issuer: runIssuer },
  } = t.context;
  const {
    vaultFactory: { lender, vaultFactory },
    priceAuthority,
  } = services;
  const managerNotifier = await E(
    E(lender).getCollateralManager(aethBrand),
  ).getNotifier();
  let managerNotification = await E(managerNotifier).getUpdateSince();

  /** @type {UserSeat<VaultKit>} */
  let lastSeat;
  let notification = {};
  let lastOfferResult;
  const makeVaultDriver = async (collateral, debt) => {
    /** @type {UserSeat<VaultKit>} */
    const vaultSeat = await E(zoe).offer(
      await E(lender).makeVaultInvitation(),
      harden({
        give: { Collateral: collateral },
        want: { RUN: debt },
      }),
      harden({
        Collateral: aethMint.mintPayment(collateral),
      }),
    );
    const {
      vault,
      publicNotifiers: { vault: notifier },
    } = await E(vaultSeat).getOfferResult();
    t.truthy(await E(vaultSeat).hasExited());
    return {
      vault: () => vault,
      vaultSeat: () => vaultSeat,
      notification: () => notification,
      close: async () => {
        lastSeat = await E(zoe).offer(E(vault).makeCloseInvitation());
        lastOfferResult = await E(lastSeat).getOfferResult();
        t.is(
          lastOfferResult,
          'your loan is closed, thank you for your business',
        );
        t.truthy(await E(vaultSeat).hasExited());
      },
      checkNotify: async (phase, expected) => {
        notification = await E(notifier).getUpdateSince();
        trace(t, 'notify', notification);
        t.is(notification.value.vaultState, phase);
        expected && t.like(notification.value, expected);
      },
      awaitNotify: async (phase, expected) => {
        notification = await E(notifier).getUpdateSince(
          notification.updateCount,
        );
        trace(t, 'notify', notification);
        t.is(notification.value.vaultState, phase);
        expected && t.like(notification.value, expected);
      },
      checkBorrowed: async (loanAmount, loanFee) => {
        const debtAmount = await E(vault).getCurrentDebt();
        const fee = ceilMultiplyBy(loanAmount, loanFee);
        t.deepEqual(
          debtAmount,
          AmountMath.add(loanAmount, fee),
          'borrower RUN amount does not match',
        );
        return debtAmount;
      },
      checkBalance: async (expectedDebt, expectedAEth) => {
        t.deepEqual(await E(vault).getCurrentDebt(), expectedDebt);
        t.deepEqual(await E(vault).getCollateralAmount(), expectedAEth);
      },
    };
  };

  const driver = {
    managerNotification: () => managerNotification,
    lastSeat: () => lastSeat,
    lastOfferResult: () => lastOfferResult,
    timer: () => timer,
    tick: (ticks = 1) => {
      for (let i = 0; i < ticks; i += 1) {
        timer.tick();
      }
    },
    makeVault: makeVaultDriver,
    checkPayouts: async (expectedRUN, expectedAEth) => {
      const payouts = await E(lastSeat).getPayouts();
      const collProceeds = await aethIssuer.getAmountOf(payouts.Collateral);
      const runProceeds = await E(runIssuer).getAmountOf(payouts.RUN);
      t.deepEqual(runProceeds, expectedRUN);
      t.deepEqual(collProceeds, expectedAEth);
    },
    checkRewards: async expectedRUN => {
      t.deepEqual(await E(vaultFactory).getRewardAllocation(), {
        RUN: expectedRUN,
      });
    },
    sellOnAMM: async (give, want, optStopAfter, expected) => {
      const swapInvitation = E(
        services.ammFacets.ammPublicFacet,
      ).makeSwapInvitation();
      trace(t, 'AMM sell', { give, want, optStopAfter });
      const offerArgs = optStopAfter
        ? harden({ stopAfter: optStopAfter })
        : undefined;
      lastSeat = await E(zoe).offer(
        await swapInvitation,
        harden({ give: { In: give }, want: { Out: want } }),
        harden({ In: aethMint.mintPayment(give) }),
        offerArgs,
      );
      lastOfferResult = await E(lastSeat).getOfferResult();
      if (expected) {
        const payouts = await E(lastSeat).getCurrentAllocation();
        trace(t, 'AMM payouts', payouts);
        t.like(payouts, expected);
      }
    },
    setPrice: p => priceAuthority.setPrice(makeRatioFromAmounts(p, priceBase)),
    // setLiquidationTerms('MaxImpactBP', 80n)
    setLiquidationTerms: async (name, newValue) => {
      const deadline = 3n;
      const { cast, outcome } = await E(t.context.committee).changeParam(
        harden({
          paramPath: { key: 'governedParams' },
          changes: { [name]: newValue },
        }),
        deadline,
      );
      await cast;
      await driver.tick(3);
      await outcome;
    },
    checkManagerNotifier: async (expected, optUpdateSince) => {
      managerNotification = await E(managerNotifier).getUpdateSince(
        optUpdateSince,
      );
      trace(t, 'manager notifier', managerNotification);
      expected && t.like(managerNotification.value, expected);
      return managerNotification;
    },
  };
  return driver;
};
// #endregion

test('price drop', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: runBrand },
    rates,
  } = t.context;
  // When the price falls to 636, the loan will get liquidated. 636 for 900
  // Aeth is 1.4 each. The loan is 270 RUN. The margin is 1.05, so at 636, 400
  // Aeth collateral could support a loan of 268.
  t.context.loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
  };

  const d = await makeDriver(
    t,
    AmountMath.make(runBrand, 1000n),
    AmountMath.make(aethBrand, 900n),
  );
  // Create a loan for 270 RUN with 400 aeth collateral
  const collateralAmount = AmountMath.make(aethBrand, 400n);
  const loanAmount = AmountMath.make(runBrand, 270n);
  const v = await d.makeVault(collateralAmount, loanAmount);
  trace(t, 'loan made', loanAmount, v);
  const debtAmount = await v.checkBorrowed(loanAmount, rates.loanFee);

  await v.checkNotify(Phase.ACTIVE, {
    debtSnapshot: {
      debt: debtAmount,
      interest: makeRatio(100n, runBrand),
    },
  });
  await v.checkBalance(debtAmount, collateralAmount);

  // small change doesn't cause liquidation
  await d.setPrice(AmountMath.make(runBrand, 677n));
  trace(t, 'price dropped a little');
  await d.tick();
  await v.checkNotify(Phase.ACTIVE);

  await d.setPrice(AmountMath.make(runBrand, 636n));
  trace(t, 'price dropped enough to liquidate');
  await v.awaitNotify(Phase.LIQUIDATING);

  // Collateral consumed while liquidating
  // Debt remains while liquidating
  await v.checkBalance(debtAmount, AmountMath.makeEmpty(aethBrand));
  const collateralExpected = AmountMath.make(aethBrand, 210n);
  const debtExpected = AmountMath.makeEmpty(runBrand);
  await v.awaitNotify(Phase.LIQUIDATED, { locked: collateralExpected });
  await v.checkBalance(debtExpected, collateralExpected);

  await d.checkRewards(AmountMath.make(runBrand, 14n));

  await v.close();
  await v.checkNotify(Phase.CLOSED, {
    locked: AmountMath.makeEmpty(aethBrand),
    updateCount: undefined,
  });
  await d.checkPayouts(debtExpected, collateralExpected);
  await v.checkBalance(debtExpected, AmountMath.makeEmpty(aethBrand));
});

test('price falls precipitously', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: runBrand },
    rates,
  } = t.context;
  t.context.loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
  };
  const d = await makeDriver(
    t,
    AmountMath.make(runBrand, 2200n),
    AmountMath.make(aethBrand, 900n),
  );
  // Create a loan for 370 RUN with 400 aeth collateral
  const collateralAmount = AmountMath.make(aethBrand, 400n);
  const loanAmount = AmountMath.make(runBrand, 370n);
  const v = await d.makeVault(collateralAmount, loanAmount);
  trace(t, 'loan made', loanAmount, v);
  const debtAmount = await v.checkBorrowed(loanAmount, rates.loanFee);

  await v.checkNotify(Phase.ACTIVE, {
    debtSnapshot: {
      debt: debtAmount,
      interest: makeRatio(100n, runBrand),
    },
  });
  await v.checkBalance(debtAmount, collateralAmount);

  // Sell some aEth to drive the value down
  await d.sellOnAMM(
    AmountMath.make(aethBrand, 200n),
    AmountMath.makeEmpty(runBrand),
  );

  // [2200n, 19180n, 1650n, 150n],
  await d.setPrice(AmountMath.make(runBrand, 19180n));
  await v.checkBalance(debtAmount, collateralAmount);
  await d.tick();
  await v.checkNotify(Phase.ACTIVE);

  await d.setPrice(AmountMath.make(runBrand, 1650n));
  await d.tick();
  await v.checkBalance(debtAmount, collateralAmount);
  await v.checkNotify(Phase.ACTIVE);

  // Drop price a lot
  await d.setPrice(AmountMath.make(runBrand, 150n));
  await v.awaitNotify(Phase.LIQUIDATING);
  await v.checkBalance(debtAmount, AmountMath.makeEmpty(aethBrand));
  // was AmountMath.make(runBrand, 103n)

  // Collateral consumed while liquidating
  // Debt remains while liquidating
  await v.checkBalance(debtAmount, AmountMath.makeEmpty(aethBrand));
  const collateralExpected = AmountMath.make(aethBrand, 141n);
  const debtExpected = AmountMath.makeEmpty(runBrand);
  await v.awaitNotify(Phase.LIQUIDATED, { locked: collateralExpected });
  await v.checkBalance(debtExpected, collateralExpected);

  await d.checkRewards(AmountMath.make(runBrand, 19n));

  await v.close();
  await v.checkNotify(Phase.CLOSED, {
    locked: AmountMath.makeEmpty(aethBrand),
    updateCount: undefined,
  });
  await d.checkPayouts(debtExpected, collateralExpected);
  await v.checkBalance(debtExpected, AmountMath.makeEmpty(aethBrand));
});

test('update liquidator', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: debtBrand },
  } = t.context;
  t.context.runInitialLiquidity = AmountMath.make(debtBrand, 500_000_000n);
  t.context.aethInitialLiquidity = AmountMath.make(aethBrand, 100_000_000n);

  const d = await makeDriver(
    t,
    AmountMath.make(debtBrand, 500n),
    AmountMath.make(aethBrand, 100n),
  );
  const loanAmount = AmountMath.make(debtBrand, 300n);
  const collateralAmount = AmountMath.make(aethBrand, 100n);
  /* * @type {UserSeat<VaultKit>} */
  const v = await d.makeVault(collateralAmount, loanAmount);
  const debtAmount = await E(v.vault()).getCurrentDebt();
  await v.checkBalance(debtAmount, collateralAmount);

  let govNotify = await d.checkManagerNotifier();
  const oldLiquidator = govNotify.value.liquidatorInstance;
  trace(t, 'gov start', oldLiquidator, govNotify);
  await d.setLiquidationTerms(
    'LiquidationTerms',
    harden({
      MaxImpactBP: 80n,
      OracleTolerance: makeRatio(30n, debtBrand),
      AMMMaxSlippage: makeRatio(30n, debtBrand),
    }),
  );
  await waitForPromisesToSettle();
  govNotify = await d.checkManagerNotifier();
  const newLiquidator = govNotify.value.liquidatorInstance;
  t.not(oldLiquidator, newLiquidator);

  // trigger liquidation
  await d.setPrice(AmountMath.make(debtBrand, 300n));
  await waitForPromisesToSettle();
  await v.checkNotify(Phase.LIQUIDATED);
});

test('liquidate many', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: runBrand },
    rates,
  } = t.context;
  // When the price falls to 636, the loan will get liquidated. 636 for 900
  // Aeth is 1.4 each. The loan is 270 RUN. The margin is 1.05, so at 636, 400
  // Aeth collateral could support a loan of 268.

  const overThreshold = async v => {
    const debt = await E(v.vault()).getCurrentDebt();
    return ceilMultiplyBy(
      ceilMultiplyBy(debt, rates.liquidationMargin),
      makeRatio(300n, runBrand),
    );
  };
  const d = await makeDriver(
    t,
    AmountMath.make(runBrand, 1500n),
    AmountMath.make(aethBrand, 900n),
  );
  const collateral = AmountMath.make(aethBrand, 300n);
  const run = amt => AmountMath.make(runBrand, amt);
  const v0 = await d.makeVault(collateral, run(390n));
  const v1 = await d.makeVault(collateral, run(380n));
  const v2 = await d.makeVault(collateral, run(370n));
  const v3 = await d.makeVault(collateral, run(360n));
  const v4 = await d.makeVault(collateral, run(350n));
  const v5 = await d.makeVault(collateral, run(340n));
  const v6 = await d.makeVault(collateral, run(330n));
  const v7 = await d.makeVault(collateral, run(320n));
  const v8 = await d.makeVault(collateral, run(310n));
  const v9 = await d.makeVault(collateral, run(300n));

  await d.setPrice(await overThreshold(v1));
  await waitForPromisesToSettle();
  await v0.checkNotify(Phase.LIQUIDATED);
  await v1.checkNotify(Phase.ACTIVE);
  await v2.checkNotify(Phase.ACTIVE);
  await v3.checkNotify(Phase.ACTIVE);
  await v4.checkNotify(Phase.ACTIVE);
  await v5.checkNotify(Phase.ACTIVE);
  await v6.checkNotify(Phase.ACTIVE);
  await v7.checkNotify(Phase.ACTIVE);
  await v8.checkNotify(Phase.ACTIVE);
  await v9.checkNotify(Phase.ACTIVE);

  await d.setPrice(await overThreshold(v5));
  await waitForPromisesToSettle();
  await v1.checkNotify(Phase.LIQUIDATED);
  await v2.checkNotify(Phase.LIQUIDATED);
  await v3.checkNotify(Phase.LIQUIDATED);
  await v4.checkNotify(Phase.LIQUIDATED);
  await v5.checkNotify(Phase.ACTIVE);
  await v6.checkNotify(Phase.ACTIVE);
  await v7.checkNotify(Phase.ACTIVE);
  await v8.checkNotify(Phase.ACTIVE);
  await v9.checkNotify(Phase.ACTIVE);

  await d.setPrice(run(300n));
  await waitForPromisesToSettle();
  await v5.checkNotify(Phase.LIQUIDATED);
  await v6.checkNotify(Phase.LIQUIDATED);
  await v7.checkNotify(Phase.LIQUIDATED);
  await v8.checkNotify(Phase.LIQUIDATED);
  await v9.checkNotify(Phase.LIQUIDATED);
});

// 1) `give` sells for more than `stopAfter`, and got some of the input back
test('amm stopAfter - input back', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: runBrand },
  } = t.context;
  const d = await makeDriver(
    t,
    AmountMath.make(runBrand, 2_199n),
    AmountMath.make(aethBrand, 999n),
  );
  const give = AmountMath.make(aethBrand, 100n);
  const want = AmountMath.make(runBrand, 80n);
  const stopAfter = AmountMath.make(runBrand, 100n);
  const expectedAeth = AmountMath.make(aethBrand, 38n);
  const expectedRUN = stopAfter;
  await d.sellOnAMM(give, want, stopAfter, {
    In: expectedAeth,
    Out: expectedRUN,
  });
});

// 2) `give` wouldn't have sold for `stopAfter`, so sell it all
test('amm stopAfter - shortfall', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: runBrand },
  } = t.context;
  // uses off-by-one amounts to force rounding errors
  const d = await makeDriver(
    t,
    AmountMath.make(runBrand, 2_199n),
    AmountMath.make(aethBrand, 999n),
  );
  const give = AmountMath.make(aethBrand, 100n);
  const want = AmountMath.make(runBrand, 80n);
  // 164 is the most I could get
  const stopAfter = AmountMath.make(runBrand, 180n);
  const expectedAeth = AmountMath.makeEmpty(aethBrand);
  const expectedRUN = AmountMath.make(runBrand, 164n);
  await d.sellOnAMM(give, want, stopAfter, {
    In: expectedAeth,
    Out: expectedRUN,
  });
});

// 3) wouldn't have sold for enough, so sold everything,
//    and that still wasn't enough for `want.Out`
test('amm stopAfter - want too much', async t => {
  const {
    aethKit: { brand: aethBrand },
    runKit: { brand: runBrand },
  } = t.context;
  // uses off-by-one amounts to force rounding errors
  const d = await makeDriver(
    t,
    AmountMath.make(runBrand, 2_199n),
    AmountMath.make(aethBrand, 999n),
  );
  const give = AmountMath.make(aethBrand, 100n);
  const want = AmountMath.make(runBrand, 170n);
  const stopAfter = AmountMath.make(runBrand, 180n);
  const expectedAeth = give;
  const expectedRUN = AmountMath.makeEmpty(runBrand);
  await d.sellOnAMM(give, want, stopAfter, {
    In: expectedAeth,
    Out: expectedRUN,
  });
});
