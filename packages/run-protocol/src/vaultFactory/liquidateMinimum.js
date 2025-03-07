// @ts-check

import { E } from '@endo/eventual-send';
import { offerTo } from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';

import { makeTracer } from '../makeTracer.js';

const trace = makeTracer('LiqMin', false);

/**
 * This contract liquidates the minimum amount of vault's collateral necessary
 * to satisfy the debt. It uses the AMM's swapOut, which sells no more than
 * necessary. Because it has offer safety, it can refuse the trade. When that
 * happens, we fall back to selling using the default strategy, which currently
 * uses the AMM's swapIn instead.
 *
 * @param {ZCF<{
 *   amm: AutoswapPublicFacet,
 * }>} zcf
 */
const start = async zcf => {
  const { amm } = zcf.getTerms();
  trace('start', zcf.getTerms());

  /**
   * @param {ZCFSeat} debtorSeat
   * @param {{ debt: Amount<'nat'> }} options
   */
  const debtorHook = async (debtorSeat, { debt }) => {
    const debtBrand = debt.brand;
    const {
      give: { In: amountIn },
    } = debtorSeat.getProposal();

    const swapInvitation = E(amm).makeSwapInvitation();
    const liqProposal = harden({
      give: { In: amountIn },
      want: { Out: AmountMath.makeEmpty(debtBrand) },
    });
    trace(`OFFER TO DEBT: `, debt, amountIn);
    const { deposited } = await offerTo(
      zcf,
      swapInvitation,
      undefined, // The keywords were mapped already
      liqProposal,
      debtorSeat,
      debtorSeat,
      { stopAfter: debt },
    );
    const amounts = await deposited;
    trace(`Liq results`, {
      debt,
      amountIn,
      paid: debtorSeat.getCurrentAllocation(),
      amounts,
    });
    debtorSeat.exit();
  };

  const creatorFacet = Far('debtorInvitationCreator', {
    makeLiquidateInvitation: () => zcf.makeInvitation(debtorHook, 'Liquidate'),
  });

  return harden({ creatorFacet });
};

/** @typedef {ContractOf<typeof start>} LiquidationContract */

harden(start);
export { start };
