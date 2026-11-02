/** Owner November 1: halve future guarantees, preserving the 200 / 25k event. */
export const GUARANTEE_REDUCTION_START_MS = Date.parse('2026-11-02T06:00:00Z');

function guaranteeLabel(value: number): string {
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

export function reducedGuaranteeCopy(text: unknown, before: number, after: number): unknown {
  if (typeof text !== 'string') return text;
  let next = text;
  const escape = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [oldLabel, newLabel] of [
    [guaranteeLabel(before), guaranteeLabel(after)],
    [String(before), String(after)],
  ]) {
    for (const suffix of [' GTD', ' Guarantee', ' Chip Guarantee', ' Diamond Guarantee'])
      next = next.replace(
        new RegExp(`(?<![\\d.])${escape(oldLabel)}${suffix}`, 'g'),
        `${newLabel}${suffix}`
      );
    next = next.split(`Nightly ${oldLabel}`).join(`Nightly ${newLabel}`);
  }
  return next;
}

/** Apply once to freshly built schedule terms, before native Diamond conversion. */
export function withReducedTournamentGuarantee(
  row: Record<string, unknown>
): Record<string, unknown> {
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
  const after = Math.round(before * 50) / 100;
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

/** Stable named-family lookup across the owner's guarantee label change. */
export function guaranteeTargetNameFilter(prefix: string): string {
  const safe = prefix.replace(/[%_]/g, '');
  const reduced = safe
    .replace(
      /(Nightly )(\d+(?:\.\d+)?)(K?)/g,
      (_, lead: string, amount: string, unit: string) => `${lead}${Number(amount) / 2}${unit}`
    )
    .replace(
      /(\d+(?:\.\d+)?)(K?)( GTD)/g,
      (_, amount: string, unit: string, suffix: string) => `${Number(amount) / 2}${unit}${suffix}`
    );
  // PostgREST quoted values protect punctuation in event names (notably NLH).
  const quote = (value: string) => JSON.stringify(value + '%');
  return [...new Set([safe, reduced])].map((value) => `name.ilike.${quote(value)}`).join(',');
}
