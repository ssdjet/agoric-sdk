// @ts-check

/**
 * @typedef {object} ImprovedNoFeeSwapResult
 * @property {Amount} amountIn
 * @property {Amount} amountOut
 */

/**
 * @typedef {object} FeePair
 *
 * @property {Amount} poolFee
 * @property {Amount} protocolFee
 */

/**
 * @typedef {object} PoolAllocation
 *
 * @property {Amount} Central
 * @property {Amount} Secondary
 */

/**
 * @typedef {object} NoFeeSwapFnInput
 * @property {Amount} amountGiven
 * @property {Amount} amountWanted
 * @property {Brand=} brand
 * @property {PoolAllocation} poolAllocation
 */

/**
 * @typedef {object} SwapResult
 *
 * @property {Amount} xIncrement
 * @property {Amount} swapperGives
 * @property {Amount} yDecrement
 * @property {Amount} swapperGets
 * @property {Amount} protocolFee
 * @property {Amount} poolFee
 * @property {Amount} newY
 * @property {Amount} newX
 */

/**
 * This is the type for swapInNoFees and swapOutNoFees. pricesForStatedInput()
 * uses swapInNoFees, while pricesForStatedOutput() uses swapOutNoFees.
 *
 * @callback NoFeeSwapFn
 * @param {NoFeeSwapFnInput} input
 * @returns {ImprovedNoFeeSwapResult}
 */

/**
 * @typedef {FeePair & ImprovedNoFeeSwapResult} FeeEstimate
 */

/**
 * @callback CalculateFees
 * @param {Amount} amountGiven
 * @param {PoolAllocation} poolAllocation
 * @param {Amount} amountWanted
 * @param {Ratio} protocolFeeRatio
 * @param {Ratio} poolFeeRatio
 * @param {NoFeeSwapFn} swapFn
 * @returns {FeeEstimate}
 */

/**
 * @callback InternalSwap
 * @param {Amount} amountGiven
 * @param {PoolAllocation} poolAllocation
 * @param {Amount} amountWanted
 * @param {Ratio} protocolFeeRatio
 * @param {Ratio} poolFeeRatio
 * @param {NoFeeSwapFn} swapFn
 * @returns {SwapResult}
 */

/**
 * @callback CalcSwapInPrices
 * @param {Amount} amountGiven
 * @param {PoolAllocation} poolAllocation
 * @param {Amount=} amountWanted
 * @param {Ratio} protocolFeeRatio
 * @param {Ratio} poolFeeRatio
 * @returns {SwapResult}
 */
/**
 * @callback CalcSwapOutPrices
 * @param {Amount=} amountGiven
 * @param {PoolAllocation} poolAllocation
 * @param {Amount} amountWanted
 * @param {Ratio} protocolFeeRatio
 * @param {Ratio} poolFeeRatio
 * @returns {SwapResult}
 */

/**
 * @typedef {object} GetXYParam
 * @property {Amount=} amountGiven
 * @property {PoolAllocation} poolAllocation
 * @property {Amount=} amountWanted
 */

/**
 * @typedef {object} GetXYResultDeltaX
 * @property {Amount} x
 * @property {Amount} y
 * @property {Amount} deltaX
 * @property {Amount|undefined} deltaY
 */

/**
 * @typedef {object} GetXYResultDeltaY
 * @property {Amount} x
 * @property {Amount} y
 * @property {Amount} deltaY
 * @property {Amount|undefined} deltaX
 */

/**
 * @typedef {GetXYResultDeltaX & GetXYResultDeltaY} GetXYResult
 */

/**
 * @callback GetXY
 * @param {GetXYParam} obj
 * @returns {GetXYResult}
 */
