// @ts-check

import '@agoric/governance/src/exported.js';
import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

// The vaultFactory owns a number of VaultManagers and a mint for RUN.
//
// addVaultType is a closely held method that adds a brand new collateral type.
// It specifies the initial exchange rate for that type. It depends on a
// separately specified AMM to provide the ability to liquidate loans that are
// in arrears. We could check that the AMM has sufficient liquidity, but for the
// moment leave that to those participating in the governance process for adding
// new collateral type to ascertain.

// This contract wants to be managed by a contractGovernor, but it isn't
// compatible with contractGovernor, since it has a separate paramManager for
// each Vault. This requires it to manually replicate the API of contractHelper
// to satisfy contractGovernor. It needs to return a creatorFacet with
// { getParamMgrRetriever, getInvitation, getLimitedCreatorFacet }.

import { assertElectorateMatches } from '@agoric/governance';
import {
  makeVaultDirectorParamManager,
  LIQUIDATION_INSTALL_KEY,
  LIQUIDATION_TERMS_KEY,
} from './params.js';
import { makeVaultDirector } from './vaultDirector.js';

/**
 * @typedef {ZCF<GovernanceTerms<{}> & {
 *   ammPublicFacet: AutoswapPublicFacet,
 *   liquidationInstall: Installation<import('./liquidateMinimum.js').start>,
 *   loanTimingParams: {ChargingPeriod: ParamRecord<'nat'>, RecordingPeriod: ParamRecord<'nat'>},
 *   timerService: TimerService,
 *   priceAuthority: ERef<PriceAuthority>}>} VaultFactoryZCF
 */

/**
 * @param {VaultFactoryZCF} zcf
 * @param {{feeMintAccess: FeeMintAccess, initialPoserInvitation: Invitation}} privateArgs
 */
export const start = async (zcf, privateArgs) => {
  const { feeMintAccess, initialPoserInvitation } = privateArgs;
  const debtMint = await zcf.registerFeeMint('RUN', feeMintAccess);
  zcf.setTestJig(() => ({
    runIssuerRecord: debtMint.getIssuerRecord(),
  }));

  const {
    // @ts-expect-error
    [LIQUIDATION_INSTALL_KEY]: { value: liqInstall },
    // @ts-expect-error
    [LIQUIDATION_TERMS_KEY]: { value: liqTerms },
  } = zcf.getTerms().governedParams;
  /** a powerful object; can modify the invitation */
  const vaultDirectorParamManager = await makeVaultDirectorParamManager(
    zcf.getZoeService(),
    initialPoserInvitation,
    liqInstall,
    liqTerms,
  );

  assertElectorateMatches(
    vaultDirectorParamManager,
    zcf.getTerms().governedParams,
  );

  const factory = makeVaultDirector(zcf, vaultDirectorParamManager, debtMint);

  return harden({
    creatorFacet: factory.creator,
    publicFacet: factory.public,
  });
};

/** @typedef {ContractOf<typeof start>} VaultFactoryContract */
