// @ts-check
/// <reference types="ses"/>

/**
 * @typedef {Object} JsonHttpRequest
 * @property {string} hostname
 * @property {number} port
 * @property {string} path
 */

/**
 * @callback JsonHttpCall
 * @param {JsonHttpRequest} request
 * @param {unknown} requestBody
 * @returns {Promise<unknown>}
 */

/**
 * @typedef {Object} EndoZipBase64Bundle
 * @property {'endoZipBase64Sha512'} moduleFormat
 * @property {string} endoZipBase64
 * @property {string} endoZipBase64Sha512
 */

/**
 * @typedef {Object} EndoZipBase64Sha512Bundle
 * @property {'endoZipBase64Sha512'} moduleFormat
 * @property {string} endoZipBase64Sha512
 */

const { details: X, quote: q } = assert;

/**
 * @param {unknown} bundle
 * @param {Object} args
 * @param {string} args.host
 * @param {number} args.port
 * @param {Object} powers
 * @param {JsonHttpCall} powers.jsonHttpCall
 * @param {(hostPort: string) => Promise<string>} powers.getAccessToken
 */
const publishBundleOverHttp = async (
  bundle,
  { host, port },
  { jsonHttpCall, getAccessToken },
) => {
  const accessToken = await getAccessToken(`${host}:${port}`);

  const response = await jsonHttpCall(
    {
      hostname: host,
      port,
      path: `/publish-bundle?accessToken=${encodeURIComponent(accessToken)}`,
    },
    bundle,
  );
  assert.typeof(
    response,
    'object',
    X`Expected JSON object response body, got ${response}`,
  );
  assert(response, X`Expected non-null response body, got ${response}`);
  const { ok } = response;
  if (!ok) {
    const { rej } = response;
    assert.typeof(
      rej,
      'string',
      X`Expected "rej" property on JSON response body with "ok": false, got ${response}`,
    );
    throw new Error(
      `Cannot publish bundle, HTTP 200 OK, JSON well-formed, but error message from service: ${rej}`,
    );
  }
};

/**
 * @typedef {Object} ChainCosmosSDKConnectionSpec
 * @property {'chain-cosmos-sdk' | 'fake-chain'} type
 * @property {string} chainID
 * @property {string} homeDirectory
 */

/**
 * @param {unknown} bundle
 * @param {unknown} connectionSpec
 * @param {Object} powers
 * @param {JsonHttpCall} [powers.jsonHttpCall]
 * @param {(hostPort: string) => Promise<string>} [powers.getAccessToken]
 * @param {(bundle: unknown, connectionSpec: unknown) => Promise<void>} [powers.publishBundleCosmos]
 * @param {() => unknown} [powers.getDefaultConnection]
 * @returns {Promise<EndoZipBase64Sha512Bundle>}
 */
const publishBundle = async (
  bundle,
  connectionSpec,
  { getAccessToken, jsonHttpCall, publishBundleCosmos, getDefaultConnection },
) => {
  // We attempt to construct a hash bundle for the given bundle first, to
  // ensure that we can before attempting to publish.
  // The publisher will not necessarily be able to do this for us, so we cannot
  // depend on the server to convert the bundle to its corresponding hash
  // bundle.
  // For example, publishing to a chain is a one-way operation that gets queued
  // to be processed possibly long after the server responds, and does not
  // guarantee success.
  // A hash bundle is the bundle format that a method like
  // E(zoe).install(hashBundle) must accept after the actual bundle has been
  // published.

  /** @type {EndoZipBase64Sha512Bundle | undefined} */
  let hashBundle;
  assert.typeof(bundle, 'object', `Bundle must be object, got ${bundle}`);
  assert(bundle !== null, `Bundle must not be null, got ${bundle}`);
  const { moduleFormat } = bundle;
  assert.typeof(
    moduleFormat,
    'string',
    X`Expected string "moduleFormat" on bundle`,
  );
  if (moduleFormat === 'endoZipBase64') {
    const { endoZipBase64Sha512 } = bundle;
    assert.typeof(
      endoZipBase64Sha512,
      'string',
      X`Expected string "endoZipBase64Sha512" on bundle`,
    );
    hashBundle = harden({
      moduleFormat: 'endoZipBase64Sha512',
      endoZipBase64Sha512,
    });
  }
  assert(
    hashBundle !== undefined,
    X`Unrecognized bundle format ${q(
      moduleFormat,
    )}, publishBundle supports only "endoZipBase64" with "endoZipBase64Sha512"`,
  );

  if (connectionSpec === undefined && getDefaultConnection !== undefined) {
    connectionSpec = await getDefaultConnection();
  }

  assert.typeof(
    connectionSpec,
    'object',
    X`Expected object for connectionSpec, got ${connectionSpec}`,
  );
  assert(connectionSpec, X`Expected non-null connectionSpec`);
  const { type } = connectionSpec;
  assert.typeof(type, 'string', X`Expected string "type" on connectionSpec`);
  if (type === 'http') {
    const { host, port } = connectionSpec;
    assert.typeof(
      host,
      'string',
      X`Expected "host" string on "http" type connectionSpec, ${connectionSpec}`,
    );
    assert.typeof(
      port,
      'number',
      X`Expected "port" number on "http" type connectionSpec, ${connectionSpec}`,
    );
    assert(
      Number.isInteger(port),
      X`Expected integer "port" on "http" type connectionSpec, ${connectionSpec}`,
    );
    assert(getAccessToken, 'access token required for HTTP connection type');
    assert(jsonHttpCall, 'HTTP power required');
    await publishBundleOverHttp(
      bundle,
      { host, port },
      { jsonHttpCall, getAccessToken },
    );
  } else if (type === 'chain-cosmos-sdk' || type === 'fake-chain') {
    assert.typeof(
      connectionSpec,
      'object',
      'Connection details must be an object',
    );
    assert(connectionSpec !== null, 'Connection details must not be null');

    const { chainID = 'agoric', homeDirectory } = connectionSpec;

    assert.typeof(
      chainID,
      'string',
      `connection chainID must be a string, got ${chainID}`,
    );

    assert.typeof(
      chainID,
      'string',
      `connection chainID must be a string, got ${chainID}`,
    );
    assert.typeof(
      homeDirectory,
      'string',
      `connection homeDirectory must be a string, got ${homeDirectory}`,
    );

    assert(
      publishBundleCosmos,
      'Cosmos SDK installation transaction submitter required',
    );
    await publishBundleCosmos(bundle, {
      chainID,
      homeDirectory,
    });
  } else {
    throw new Error(`Unsupported connection type ${type}`);
  }

  return hashBundle;
};

/**
 * @param {Object} powers
 * @param {JsonHttpCall} [powers.jsonHttpCall]
 * @param {(hostPort: string) => Promise<string>} [powers.getAccessToken]
 * @param {(bundle: unknown, connectionSpec: unknown) => Promise<void>} [powers.publishBundleCosmos]
 * @param {() => unknown} [powers.getDefaultConnection]
 */
export const makeBundlePublisher = powers => {
  /**
   * @param {unknown} bundle
   * @param {unknown} connectionSpec
   */
  return async (bundle, connectionSpec) =>
    publishBundle(bundle, connectionSpec, powers);
};
