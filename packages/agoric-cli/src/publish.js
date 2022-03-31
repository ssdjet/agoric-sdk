// @ts-check

import tmp from 'tmp';

/**
 * @typedef {Object} ChainCosmosSDKConnectionSpec
 * @property {'chain-cosmos-sdk' | 'fake-chain'} type
 * @property {string} chainID
 * @property {string} homeDirectory
 */

/**
 * @param {Object} args
 * @param {ReturnType<import('./helpers.js').makePspawn>} args.pspawn
 * @param {string} args.cosmosHelper
 * @param {typeof import('path').resolve} args.pathResolve
 * @param {typeof import('fs').promises.writeFile} args.writeFile
 */
export const makeCosmosBundlePublisher = ({
  pspawn,
  cosmosHelper,
  pathResolve,
  writeFile,
}) => {
  /**
   * @param {unknown} bundle
   * @param {ChainCosmosSDKConnectionSpec} connectionSpec
   */
  const publishBundleCosmos = async (bundle, connectionSpec) => {
    const { chainID = 'agoric', homeDirectory } = connectionSpec;

    const { name: tempDirPath, removeCallback } = tmp.dirSync({
      unsafeCleanup: true,
      prefix: 'agoric-cli-bundle-',
    });
    try {
      const tempFilePath = pathResolve(tempDirPath, 'bundle.json');
      await writeFile(tempFilePath, `${JSON.stringify(bundle)}\n`);
      const args = [
        'tx',
        'swingset',
        'install-bundle',
        '--gas',
        'auto',
        '--gas-adjustment',
        '1.2',
        '--home',
        homeDirectory,
        '--keyring-backend',
        'test',
        '--from',
        'ag-solo',
        '--chain-id',
        chainID,
        '--yes',
        `@${tempFilePath}`,
      ];
      await pspawn(cosmosHelper, args);
    } finally {
      removeCallback();
    }
  };

  return publishBundleCosmos;
};
