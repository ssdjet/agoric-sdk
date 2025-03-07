/* global process */
// @ts-check
import { E } from '@endo/far';
import { makeHelpers } from '@agoric/deploy-script-support';

import { getCopyMapEntries, makeCopyMap } from '@agoric/store';
import {
  getManifestForRunProtocol,
  getManifestForEconCommittee,
  getManifestForMain,
} from '../src/core-proposal.js';

/** @type {<T>(store: any, key: string, make: () => T) => Promise<T>} */
const provide = async (store, key, make) => {
  const found = await E(store).get(key);
  if (found) {
    return found;
  }
  const value = make();
  await E(store).set(key, value);
  return value;
};

/** @type {Record<string, Record<string, [string, string]>>} */
const installKeyGroups = {
  econCommittee: {
    contractGovernor: [
      '@agoric/governance/src/contractGovernor.js',
      '../../governance/bundles/bundle-contractGovernor.js',
    ],
    committee: [
      '@agoric/governance/src/committee.js',
      '../../governance/bundles/bundle-committee.js',
    ],
    binaryVoteCounter: [
      '@agoric/governance/src/binaryVoteCounter.js',
      '../../governance/bundles/bundle-binaryVoteCounter.js',
    ],
  },
  runStake: {
    runStake: ['../src/runStake/runStake.js', '../bundles/bundle-runStake.js'],
  },
  main: {
    amm: [
      '../src/vpool-xyk-amm/multipoolMarketMaker.js',
      '../bundles/bundle-amm.js',
    ],
    vaultFactory: [
      '../src/vaultFactory/vaultFactory.js',
      '../bundles/bundle-vaultFactory.js',
    ],
    liquidateMinimum: [
      '../src/vaultFactory/liquidateMinimum.js',
      '../bundles/bundle-liquidateMinimum.js',
    ],
    liquidate: [
      '../src/vaultFactory/liquidateIncrementally.js',
      '../bundles/bundle-liquidateIncrementally.js',
    ],
    reserve: ['../src/reserve/assetReserve.js', '../bundles/bundle-reserve.js'],
  },
  psm: {
    psm: ['../src/psm/psm.js', '../bundles/bundle-psm.js'],
    mintHolder: [
      '@agoric/vats/src/mintHolder.js',
      '../../vats/bundles/bundle-mintHolder.js',
    ],
  },
};

const { entries, fromEntries } = Object;

/** @type { <K extends string, T, U>(obj: Record<K, T>, f: (t: T) => U) => Record<K, U>} */
const mapValues = (obj, f) =>
  // @ts-expect-error entries() loses the K type
  harden(fromEntries(entries(obj).map(([p, v]) => [p, f(v)])));

const makeTool = async (homeP, installCacheKey = 'installCache') => {
  /** @type {CopyMap<string, {installation: Installation, boardId: string, path?: string}>} */
  const initial = await provide(E.get(homeP).scratch, installCacheKey, () =>
    makeCopyMap([]),
  );
  // ISSUE: getCopyMapEntries of CopyMap<K, V> loses K, V.
  /** @type {Map<string, {installation: Installation, boardId: string, path?: string}>} */
  const working = new Map(getCopyMapEntries(initial));

  const saveCache = async () => {
    const final = makeCopyMap(working);
    assert.equal(final.payload.keys.length, working.size);
    await E(E.get(homeP).scratch).set('installCache', final);
    console.log({
      initial: initial.payload.keys.length,
      total: working.size,
    });
  };

  const wrapInstall = install => async (mPath, bPath, opts) => {
    const { endoZipBase64Sha512: sha512 } = await import(bPath).then(
      m => m.default,
    );
    const detail = await provide(working, sha512, () =>
      install(mPath, bPath, opts).then(installation => ({
        installation,
        sha512,
        path: bPath,
      })),
    );
    return detail.installation;
  };

  const committeeProposalBuilder = async ({
    publishRef,
    install: install0,
  }) => {
    const { ROLE = 'chain' } = process.env;

    const install = wrapInstall(install0);

    /** @param { Record<string, [string, string]> } group */
    const publishGroup = group =>
      mapValues(group, ([mod, bundle]) =>
        publishRef(install(mod, bundle, { persist: true })),
      );
    return harden({
      sourceSpec: '../src/core-proposal.js',
      getManifestCall: [
        getManifestForEconCommittee.name,
        {
          ROLE,
          installKeys: {
            ...publishGroup(installKeyGroups.econCommittee),
          },
        },
      ],
    });
  };

  const mainProposalBuilder = async ({ publishRef, install: install0 }) => {
    const {
      ROLE = 'chain',
      VAULT_FACTORY_CONTROLLER_ADDR,
      ANCHOR_DENOM,
    } = process.env;

    const install = wrapInstall(install0);

    const persist = true;
    /** @param { Record<string, [string, string]> } group */
    const publishGroup = group =>
      mapValues(group, ([mod, bundle]) =>
        publishRef(install(mod, bundle, { persist })),
      );
    return harden({
      sourceSpec: '../src/core-proposal.js',
      getManifestCall: [
        getManifestForMain.name,
        {
          ROLE,
          vaultFactoryControllerAddress: VAULT_FACTORY_CONTROLLER_ADDR,
          installKeys: {
            ...publishGroup(installKeyGroups.main),
            ...publishGroup(installKeyGroups.runStake),
            ...(ANCHOR_DENOM ? publishGroup(installKeyGroups.psm) : {}),
          },
        },
      ],
    });
  };
  return { committeeProposalBuilder, mainProposalBuilder, saveCache };
};

// Build proposal for sim-chain etc.
export const defaultProposalBuilder = async ({ publishRef, install }) => {
  const {
    ROLE = 'chain',
    VAULT_FACTORY_CONTROLLER_ADDR,
    ANCHOR_DENOM,
  } = process.env;

  /** @param { Record<string, [string, string]> } group */
  const publishGroup = group =>
    mapValues(group, ([mod, bundle]) => publishRef(install(mod, bundle)));

  return harden({
    sourceSpec: '../src/core-proposal.js',
    getManifestCall: [
      getManifestForRunProtocol.name,
      {
        ROLE,
        vaultFactoryControllerAddress: VAULT_FACTORY_CONTROLLER_ADDR,
        anchorDenom: ANCHOR_DENOM,
        installKeys: {
          ...publishGroup(installKeyGroups.econCommittee),
          ...publishGroup(installKeyGroups.runStake),
          ...publishGroup(installKeyGroups.main),
          ...(ANCHOR_DENOM ? publishGroup(installKeyGroups.psm) : {}),
        },
      },
    ],
  });
};

export default async (homeP, endowments) => {
  const { writeCoreProposal } = await makeHelpers(homeP, endowments);

  const tool = await makeTool(homeP);
  await Promise.all([
    writeCoreProposal('gov-econ-committee', tool.committeeProposalBuilder),
    writeCoreProposal('gov-amm-vaults-etc', tool.mainProposalBuilder),
  ]);
  await tool.saveCache();
};
