// @ts-check
import { provide } from '@agoric/store';
import { defineDurableKind, makeKindHandle } from '@agoric/vat-data';
import { E } from '@endo/eventual-send';

/**
 * @param {MapStore<string,any>} issuerBaggage
 * @param {string} allegedName
 * @param {(allegedIssuer: Issuer) => boolean} isMyIssuerNow
 * @param {DisplayInfo} displayInfo
 * @returns {Brand}
 */
export const makeDurableBrand = (
  issuerBaggage,
  allegedName,
  isMyIssuerNow,
  displayInfo,
) => {
  const brandKindHandle = provide(issuerBaggage, 'brandKindHandle', () =>
    makeKindHandle(`${allegedName} brand`),
  );
  const makeBrand = defineDurableKind(brandKindHandle, () => ({}), {
    isMyIssuer: (_, allegedIssuerP) => E.when(allegedIssuerP, isMyIssuerNow),

    getAllegedName: () => allegedName,

    // Give information to UI on how to display the amount.
    getDisplayInfo: () => displayInfo,
  });
  const brand = makeBrand();
  return brand;
};
