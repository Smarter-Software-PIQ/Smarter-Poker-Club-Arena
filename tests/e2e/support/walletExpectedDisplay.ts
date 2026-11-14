// Test oracle for the independently read wallet amount; never import the
// production formatter, which is the behavior the browser certificate checks.
// Exact at every size (Dan 2026-11-13): separators, two decimals minimum and
// any further stored decimal kept; never an M or B abbreviation.
export function expectedWalletChipDisplay(amount: number): string {
  if (!Number.isFinite(amount)) throw new Error('Wallet expectation requires a finite balance.');
  const magnitude = Number(Math.abs(amount).toFixed(8));
  const text = magnitude.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
  return `${amount < 0 && magnitude !== 0 ? '-' : ''}${text}`;
}
