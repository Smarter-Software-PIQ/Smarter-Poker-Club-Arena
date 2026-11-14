import { isMidwayFreeBuy } from '../tournament/midwayFreeBuyPolicy.js';

/** Owner November 1: reduced guarantees, with the confirmed nightly and 1.5K terms. */
export const GUARANTEE_REDUCTION_START_MS = Date.parse('2026-11-02T06:00:00Z');

/** How an authored schedule name may write a guarantee: "5K", "1.5K". Read only, never written. */
function authoredThousandsLabel(value: number): string {
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

/**
 * The guarantee the engine writes into a name: the exact figure with
 * separators, never abbreviated (Dan 2026-11-13: "USE WHOLE NUMBERS AND
 * DECIMALS ALWAYS"). The reduced amount is already rounded to cents.
 */
export function exactGuaranteeLabel(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function reducedGuaranteeCopy(text: unknown, before: number, after: number): unknown {
  if (typeof text !== 'string' || before === after) return text;
  let next = text;
  const escape = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const newLabel = exactGuaranteeLabel(after);
  // Every way an authored name may write the old guarantee becomes the exact
  // new figure. Each old form names `before`, so no replacement can match text
  // an earlier one wrote.
  for (const oldLabel of new Set([
    authoredThousandsLabel(before),
    exactGuaranteeLabel(before),
    String(before),
  ])) {
    for (const suffix of [' GTD', ' Guarantee', ' Chip Guarantee', ' Diamond Guarantee'])
      next = next.replace(
        new RegExp(`(?<![\\d.,])${escape(oldLabel)}${suffix}`, 'g'),
        `${newLabel}${suffix}`
      );
    next = next.split(`Nightly ${oldLabel}`).join(`Nightly ${newLabel}`);
  }
  return next;
}

/** Apply once to freshly built schedule terms, before native Diamond conversion.
 * The Midway Union's daily Free Buys are exempt: their guarantees are authored
 * per slot by the owner's 2026-11-04 rotation (midwayFreeBuyPolicy.ts). */
export function withReducedTournamentGuarantee(
  row: Record<string, unknown>
): Record<string, unknown> {
  if (isMidwayFreeBuy(row)) return row;
  const start = Date.parse(String(row.start_time ?? ''));
  const before = Number(row.guaranteed_prize);
  const entry = Number(row.buy_in_amount ?? 0) + Number(row.buy_in_fee ?? 0);
  if (
    !Number.isFinite(start) ||
    start < GUARANTEE_REDUCTION_START_MS ||
    !Number.isFinite(before) ||
    before <= 0 ||
    (entry === 200 && before === 25000)
  )
    return row;
  // Owner's final board instruction preserves the 7pm 35-chip rebuy/add-on
  // and the still-unreduced Six-Card event; all other existing terms stay put.
  const preserved =
    (row.schedule_id === '099ac5a4-c866-4acb-917c-31337bf468b1' && entry === 35) ||
    row.schedule_id === '39518fc3-ee0b-4e45-83ae-3619aa9a5c07';
  const reduced = preserved ? before : Math.round(before * 50) / 100;
  const after = reduced === 1200 || reduced === 1250 ? 1500 : reduced;
  return {
    ...row,
    guaranteed_prize: after,
    name: reducedGuaranteeCopy(row.name, before, after),
    ...(row.description !== undefined
      ? { description: reducedGuaranteeCopy(row.description, before, after) }
      : {}),
    ...(row.short_description !== undefined
      ? { short_description: reducedGuaranteeCopy(row.short_description, before, after) }
      : {}),
  };
}
