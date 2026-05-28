/**
 * Sagitta demo-only reserve capacity gate.
 *
 * Before a fixed deposit is approved, Sagitta checks whether the protocol
 * treasury holds enough AVAILABLE reserve to cover the promised yield over the
 * full term.  Available reserve accounts for existing commitments:
 *
 *   availableReserveUsd  = navReserveUsd - committedReserveUsd
 *
 *   promisedYield        = depositAmount × fixedYieldApy × (termMonths / 12)
 *   requiredReserveUsd   = promisedYield × coverageRatio
 *   approved             = availableReserveUsd ≥ requiredReserveUsd
 *
 * When `availableReserveUsd` is provided in the input the gate checks against
 * it (production path with committed-reserve accounting).  When omitted the
 * gate falls back to `reserveAmountUsd` (legacy / simple path where total
 * reserve equals available reserve).
 *
 * This gate is LOCAL and DEMO-ONLY. In production it will query the
 * ReserveController on-chain (Arc deployment: 0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd)
 * and the Circle treasury balance before writing a decision back to Fineract.
 */

export interface ReserveGateInput {
  /**
   * Total treasury reserve balance in USD, read from navReserveUsd().
   * Used as the gate operand when availableReserveUsd is not provided.
   */
  reserveAmountUsd: number;
  /**
   * Available reserve after subtracting committed reserve for existing active
   * deposits.  When provided, the approval decision is made against this value
   * instead of reserveAmountUsd.
   *
   *   availableReserveUsd = navReserveUsd - committedReserveUsd
   */
  availableReserveUsd?: number;
  /** Fixed annual yield promised to depositor (decimal, e.g. 0.06 = 6 %). */
  fixedYieldApy: number;
  /** Deposit term in months. */
  termMonths: number;
  /** Reserve-to-promised-yield coverage ratio required (e.g. 1.25 = 125 %). */
  coverageRatio: number;
  /** Deposit principal requested by the client in USD. */
  requestedDepositAmountUsd: number;
}

export interface ReserveGateResult extends ReserveGateInput {
  /** The reserve value actually tested for approval (availableReserveUsd ?? reserveAmountUsd). */
  availableReserveUsd: number;
  promisedYield: number;
  /** Required reserve for the new deposit (promisedYield × coverageRatio). */
  requiredReserve: number;
  /** Alias for requiredReserve — matches the available-reserve receipt shape. */
  requiredReserveUsd: number;
  maxSupportedDepositAmountUsd: number;
  approved: boolean;
}

export function checkReserveGate(input: ReserveGateInput): ReserveGateResult {
  const { reserveAmountUsd, fixedYieldApy, termMonths, coverageRatio, requestedDepositAmountUsd } =
    input;

  // Effective reserve = available (if provided) else total
  const availableReserveUsd = input.availableReserveUsd ?? reserveAmountUsd;

  // Promised yield = principal * APY * (months / 12)
  const promisedYield = requestedDepositAmountUsd * fixedYieldApy * (termMonths / 12);

  // Required reserve = promised yield * coverage ratio
  const requiredReserve = promisedYield * coverageRatio;

  // Maximum deposit the available reserve can support (inverse formula)
  const maxSupportedDepositAmountUsd =
    coverageRatio > 0 && fixedYieldApy > 0
      ? (availableReserveUsd * 12) / (fixedYieldApy * termMonths * coverageRatio)
      : 0;

  // Approved only if available reserve covers required reserve for this deposit
  const approved = availableReserveUsd >= requiredReserve;

  return {
    ...input,
    availableReserveUsd: round2(availableReserveUsd),
    promisedYield: round2(promisedYield),
    requiredReserve: round2(requiredReserve),
    requiredReserveUsd: round2(requiredReserve),
    maxSupportedDepositAmountUsd: round2(maxSupportedDepositAmountUsd),
    approved,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
