/**
 * OPTION SHADOW SUMMARY (2026-11-18, read-only). Summarises the counterfactual receipts of options in shadow
 * (HorseDecision.optionShadowReceipt, HorseOptionShadow.ts) from decision journal records over a window, split by
 * whether a person (a seat that is not a Horse) was dealt into the hand. Pure: it reads the records it is given and
 * writes nothing. The CLI is server/scripts/horse-option-shadow-summary.ts; the daily counters (no journal needed)
 * are read by scripts/sql/horse-option-shadow-summary.sql.
 */
import type { OptionShadowReceipt } from './HorseOptionShadow.js';

export interface OptionShadowCell {
  decisions: number;
  changed: number;
  same: number;
  /** the re-decision failed or ran at another scale: no counterfactual */
  unknown: number;
  /** actual>would action pairs of the changed decisions, e.g. "fold>call"; a size-only change is "raise>raise" */
  changes: Record<string, number>;
  /** changed decisions by street */
  changedByStreet: Record<string, number>;
  /** changed decisions by variant */
  changedByVariant: Record<string, number>;
}
export interface OptionShadowSummary {
  window: { sinceMs: number | null; untilMs: number | null };
  recordsRead: number;
  decisionsWithReceipt: number;
  options: Record<string, { person: OptionShadowCell; horseOnly: OptionShadowCell }>;
}

const cell = (): OptionShadowCell => ({
  decisions: 0,
  changed: 0,
  same: 0,
  unknown: 0,
  changes: {},
  changedByStreet: {},
  changedByVariant: {},
});
const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

function isReceipt(value: unknown): value is OptionShadowReceipt {
  const r = value as Partial<OptionShadowReceipt> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    r.version === 1 &&
    typeof r.option === 'string' &&
    typeof r.changed === 'boolean' &&
    !!r.actual &&
    typeof r.actual.action === 'string'
  );
}

/** One journal record ({kind, atMs, body}) or an export row ({record: {...}}): its receipt and time, or null. */
export function optionShadowReceiptOfRecord(
  row: unknown
): { atMs: number; receipt: OptionShadowReceipt } | null {
  const r = (row as { record?: unknown })?.record ?? row;
  const rec = r as { kind?: unknown; atMs?: unknown; body?: unknown } | null;
  if (!rec || rec.kind !== 'decision' || typeof rec.atMs !== 'number') return null;
  let body: unknown = rec.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const receipt = (body as { decision?: { optionShadowReceipt?: unknown } } | null)?.decision
    ?.optionShadowReceipt;
  return isReceipt(receipt) ? { atMs: rec.atMs, receipt } : null;
}

export function summariseOptionShadow(
  rows: Iterable<unknown>,
  opts: { sinceMs?: number | null; untilMs?: number | null; option?: string | null } = {}
): OptionShadowSummary {
  const out: OptionShadowSummary = {
    window: { sinceMs: opts.sinceMs ?? null, untilMs: opts.untilMs ?? null },
    recordsRead: 0,
    decisionsWithReceipt: 0,
    options: {},
  };
  for (const row of rows) {
    out.recordsRead++;
    const found = optionShadowReceiptOfRecord(row);
    if (!found) continue;
    const { atMs, receipt } = found;
    if (opts.sinceMs != null && atMs < opts.sinceMs) continue;
    if (opts.untilMs != null && atMs >= opts.untilMs) continue;
    if (opts.option && receipt.option !== opts.option) continue;
    out.decisionsWithReceipt++;
    const slot = (out.options[receipt.option] ??= { person: cell(), horseOnly: cell() });
    const c = receipt.personDealt ? slot.person : slot.horseOnly;
    c.decisions++;
    if (!receipt.would) c.unknown++;
    else if (!receipt.changed) c.same++;
    else {
      c.changed++;
      bump(c.changes, `${receipt.actual.action}>${receipt.would.action}`);
      bump(c.changedByStreet, receipt.street);
      bump(c.changedByVariant, receipt.variant);
    }
  }
  return out;
}
