// @ts-check

/**
 * @typedef {object} VPoolPriceQuote
 * @property {Amount} amountIn
 * @property {Amount} amountOut
 */

/**
 * @typedef {object} VPool - virtual pool for price quotes and trading
 * @property {(amountIn: Amount, amountOut: Amount) => VPoolPriceQuote} getInputPrice
 * @property {(amountIn: Amount, amountOut: Amount) => VPoolPriceQuote} getOutputPrice
 */

/**
 * @typedef {object} DoublePoolSwapResult
 * @property {Amount} swapperGives
 * @property {Amount} swapperGets
 * @property {Amount} inPoolIncrement
 * @property {Amount} inPoolDecrement
 * @property {Amount} outPoolIncrement
 * @property {Amount} outPoolDecrement
 * @property {Amount} protocolFee
 */

/**
 * @callback GetDoublePoolSwapQuote
 * @param {Amount} amountIn
 * @param {Amount} amountOut
 * @returns {DoublePoolSwapResult}
 */

/**
 * @callback GetSinglePoolSwapQuote
 * @param {Amount} amountIn
 * @param {Amount} amountOut
 * @returns {SwapResult}
 */

/**
 * @typedef {object} VirtualPool - virtual pool for price quotes and trading
 * @property {GetDoublePoolSwapQuote} getPriceForInput
 * @property {GetDoublePoolSwapQuote} getPriceForOutput
 * @property {(seat: ZCFSeat, swapResult: DoublePoolSwapResult) => string} allocateGainsAndLosses
 */

/**
 * @callback AddLiquidityActual
 * @param {XYKPool} pool
 * @param {ZCFSeat} zcfSeat
 * @param {Amount<'nat'>} secondaryAmount
 * @param {Amount<'nat'>} poolCentralAmount
 * @param {ZCFSeat} [feeSeat]
 * @returns {string}
 */

/**
 * @typedef {object} XYKPool
 * @property {() => bigint} getLiquiditySupply
 * @property {() => Issuer} getLiquidityIssuer
 * @property {(seat: ZCFSeat) => string} addLiquidity
 * @property {(seat: ZCFSeat) => string} removeLiquidity
 * @property {() => ZCFSeat} getPoolSeat
 * @property {() => Amount} getSecondaryAmount
 * @property {() => Amount} getCentralAmount
 * @property {() => Notifier<Record<string, Amount>>} getNotifier
 * @property {() => void} updateState
 * @property {() => PriceAuthority} getToCentralPriceAuthority
 * @property {() => PriceAuthority} getFromCentralPriceAuthority
 * @property {() => VirtualPool} getVPool
 */

/**
 * @typedef {object} PoolFacets
 * @property {XYKPool} pool
 * @property {{addLiquidityActual: AddLiquidityActual}} helper
 * @property {VirtualPool} singlePool
 */

/**
 * @typedef {object} XYKAMMCreatorFacet
 * @property {() => Promise<Invitation>} makeCollectFeesInvitation
 */
/**
 * @typedef {object} XYKAMMPublicFacet
 * @property {(issuer: ERef<Issuer>, keyword: Keyword) => Promise<Issuer>} addPool
 * add a new liquidity pool
 * @property {() => Promise<Invitation>} makeSwapInvitation synonym for
 * makeSwapInInvitation
 * @property {() => Promise<Invitation>} makeSwapInInvitation make an invitation
 * that allows one to do a swap in which the In amount is specified and the Out
 * amount is calculated
 * @property {() => Promise<Invitation>} makeSwapOutInvitation make an invitation
 * that allows one to do a swap in which the Out amount is specified and the In
 * amount is calculated
 * @property {() => Promise<Invitation>} makeAddLiquidityInvitation make an
 * invitation that allows one to add liquidity to the pool.
 * @property {() => Promise<Invitation>} makeAddLiquidityAtRateInvitation make
 * an invitation that allows one to add liquidity to the pool at an arbitrary
 * ratio of collateral to Central.
 * @property {() => Promise<Invitation>} makeRemoveLiquidityInvitation make an
 * invitation that allows one to remove liquidity from the pool.
 * @property {(brand: Brand) => Issuer} getLiquidityIssuer
 * @property {(brand: Brand) => bigint} getLiquiditySupply get the current value of
 * liquidity in the pool for brand held by investors.
 * @property {(amountIn: Amount, amountOut: Amount) => VPoolPriceQuote} getInputPrice
 * calculate the amount of brandOut that will be returned if the amountIn is
 * offered using makeSwapInInvitation at the current price.
 * @property {(amountOut: Amount, amountIn: Amount) => VPoolPriceQuote} getOutputPrice
 * calculate the amount of brandIn that is required in order to get amountOut
 * using makeSwapOutInvitation at the current price
 * @property {(brand: Brand) => Record<string, Amount>} getPoolAllocation get an
 * AmountKeywordRecord showing the current balances in the pool for brand.
 * @property {() => Issuer} getQuoteIssuer - get the Issuer that attests to
 * the prices in the priceQuotes issued by the PriceAuthorities
 * @property {(brand: Brand) => {toCentral: PriceAuthority, fromCentral: PriceAuthority}} getPriceAuthorities
 * get a pair of PriceAuthorities { toCentral, fromCentral } for requesting
 * Prices and notifications about changing prices.
 * @property {() => Brand[]} getAllPoolBrands
 * @property {() => Allocation} getProtocolPoolBalance
 */

/**
 * @callback MakeAmmParamManager
 * @param {ERef<ZoeService>} zoe
 * @param {bigint} poolFeeBP
 * @param {bigint} protocolFeeBP
 * @param {Invitation} poserInvitation - invitation for the question poser
 * @returns {Promise<ParamManagerFull>}
 */
