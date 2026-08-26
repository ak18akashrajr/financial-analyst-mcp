// Years-to-double for an annualized (XIRR) rate, shown next to every XIRR figure in
// XirrDetailsCard.tsx's breakdown (TODO.md: "XIRR → time-to-double"). Uses the exact
// ln(2)/ln(1+rate) formula rather than the rough Rule-of-72 mental-math shortcut (72/rate%) —
// same underlying idea, just not approximated. Pure/DB-free so it's unit-testable in isolation,
// same shape as netWorthSnapshot.ts / expenseIncomeRatio.ts.

/**
 * Years to double an investment growing at annualized rate `xirr` (e.g. 0.12 for 12%).
 * Returns null when doubling time is undefined or infinite — a zero/negative rate never doubles,
 * and -100% (xirr <= -1) is a total loss with no growth rate to take a log of.
 */
export function yearsToDouble(xirr: number | null | undefined): number | null {
  if (xirr == null || !Number.isFinite(xirr) || xirr <= 0) return null;
  return Math.log(2) / Math.log(1 + xirr);
}

/** "1.3y to double" / "7.0mo to double" / "—" for null. Sub-year durations read in months. */
export function formatYearsToDouble(years: number | null): string {
  if (years == null) return '—';
  if (years < 1) return `${(years * 12).toFixed(1)}mo to double`;
  return `${years.toFixed(1)}y to double`;
}
