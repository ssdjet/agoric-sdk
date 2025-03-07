// @ts-check

/**
 * @typedef {( {zcf: ZCF} ) => void} TestJigSetter
 */

/**
 * @callback MakeZCFZygote
 *
 * Make the ZCF vat in zygote-usable form. First, a generic ZCF is
 * made, then the contract code is evaluated, then a particular
 * instance is made.
 *
 * @param {VatPowers} powers
 * @param {ERef<ZoeService>} zoeService
 * @param {Issuer} invitationIssuer
 * @param {TestJigSetter} testJigSetter
 * @returns {ZCFZygote}
 */

/**
 * @typedef ZCFZygote
 * @property {(bundleOrBundleCap: SourceBundle | BundleCap) => void} evaluateContract
 * @property {(instanceAdminFromZoe: ERef<ZoeInstanceAdmin>,
 *     instanceRecordFromZoe: InstanceRecord,
 *     issuerStorageFromZoe: IssuerRecords,
 *     privateArgs?: object,
 * ) => Promise<ExecuteContractResult>} startContract
 */
