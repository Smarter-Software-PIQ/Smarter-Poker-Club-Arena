/** Rakeback is a fractional rate, not chips. Never turn unavailable terms into zero. */
export function rakebackFigure(rate: number | null | undefined): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return 'Unavailable';
  }
  return `${(rate * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}
