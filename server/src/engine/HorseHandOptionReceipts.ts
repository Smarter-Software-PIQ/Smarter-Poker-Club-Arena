/**
 * PER-HAND OPTION RECEIPTS (2026-11-25, Hold'em Strategy lane).
 *
 * Until now a Horse option left only a daily count in the database
 * (horse_brain_telemetry: day, feature, fires). Which hands it changed lived
 * in the engine host's 72-hour decision journal and nowhere a results query
 * could join. This module is the one definition of the record that closes the
 * gap: for a listed option, each decision the option CHANGED says so in the
 * worker's reply, the table engine (and the Lightning hand host) counts those
 * per hand in memory, and the hand's existing asynchronous save writes one row
 * per (hand, receipt) into public.ca_horse_hand_receipts, for hands a person
 * was dealt into.
 *
 * WHAT A RECEIPT IS, AND ALL IT IS: the option's name, the KIND of action the
 * option was given and the KIND it left (fold, check, call, bet, raise,
 * all_in), and on the row a count of decisions. Nothing else exists in the
 * type or the row text: no card, board, hand strength, equity, amount or
 * seat. The vocabulary is closed (HAND_OPTION_RECEIPT_ROW), enforced here on
 * the way out of the worker, again on the way into the hand's count, and by a
 * CHECK on the table.
 *
 * Measurement only. Nothing reads a receipt to decide anything, and every
 * function here is synchronous, pure and total (it never throws): the
 * decision path and the action path gain no await, I/O or database call.
 * Pinned by HorseHandOptionReceipts.law.test.ts.
 */

/** The options whose changed decisions are recorded per hand. An option joins by being listed here and
 * recording a rule receipt under its own name where it changes the action (BrainTelemetry.noteDecisionRuleReceipt). */
export const HAND_OPTION_RECEIPT_OPTIONS = [
  'holdemTournamentAllInCallIsPriced',
  'cashDefenceTrimColdCalls',
] as const;
export type HandOptionReceiptOption = (typeof HAND_OPTION_RECEIPT_OPTIONS)[number];

/** The only action words a receipt may carry. */
export const HAND_OPTION_RECEIPT_KINDS = [
  'fold',
  'check',
  'call',
  'bet',
  'raise',
  'all_in',
] as const;
export type HandOptionReceiptKind = (typeof HAND_OPTION_RECEIPT_KINDS)[number];

/** One decision an option changed, as the worker's reply carries it. */
export interface HandOptionReceipt {
  option: HandOptionReceiptOption;
  /** The kind of action the option was given; null when it produced the action itself. */
  before: HandOptionReceiptKind | null;
  /** The kind of action the option left. */
  after: HandOptionReceiptKind;
}

/** One decision's reply carries at most this many (BrainTelemetry.DECISION_RULE_RECEIPTS_MAX). */
export const HAND_OPTION_RECEIPTS_PER_DECISION_MAX = 16;
/** One hand keeps at most this many distinct receipt texts; the table's smallint count is capped too. */
export const HAND_OPTION_RECEIPTS_PER_HAND_MAX = 32;
export const HAND_OPTION_RECEIPT_DECISIONS_MAX = 999;

/** The exact text of ca_horse_hand_receipts.receipt: `<option>:<before|none>><after>`. The table's CHECK is this
 * expression with the option names widened to any identifier. */
export const HAND_OPTION_RECEIPT_ROW = new RegExp(
  `^(${HAND_OPTION_RECEIPT_OPTIONS.join('|')}):(none|${HAND_OPTION_RECEIPT_KINDS.join('|')})>(${HAND_OPTION_RECEIPT_KINDS.join('|')})$`
);

const OPTIONS: ReadonlySet<string> = new Set(HAND_OPTION_RECEIPT_OPTIONS);
const KINDS: ReadonlySet<string> = new Set(HAND_OPTION_RECEIPT_KINDS);

/** The kind of an action word, or null for anything that is not one of the six. */
export function handOptionReceiptKind(action: unknown): HandOptionReceiptKind | null {
  return typeof action === 'string' && KINDS.has(action) ? (action as HandOptionReceiptKind) : null;
}

/**
 * The listed options' receipts among one decision's rule receipts, action kinds only, in order; undefined when
 * there is none (the reply then has no such field and is byte for byte what it was). A rule receipt of any other
 * rule, and one whose action is not one of the six kinds, is left out. Never throws.
 */
export function handOptionReceiptsOf(
  ruleReceipts:
    | readonly {
        receipt: string;
        before: { action: string } | null;
        after: { action: string };
      }[]
    | null
    | undefined
): HandOptionReceipt[] | undefined {
  try {
    if (!Array.isArray(ruleReceipts) || ruleReceipts.length === 0) return undefined;
    const out: HandOptionReceipt[] = [];
    for (const r of ruleReceipts) {
      if (out.length >= HAND_OPTION_RECEIPTS_PER_DECISION_MAX) break;
      if (!r || !OPTIONS.has(r.receipt)) continue;
      const after = handOptionReceiptKind(r.after?.action);
      const before = r.before === null ? null : handOptionReceiptKind(r.before?.action);
      if (after === null || (r.before !== null && before === null)) continue;
      out.push({ option: r.receipt as HandOptionReceiptOption, before, after });
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** The row text of one receipt, or null for anything that is not exactly a listed option and two kinds. */
export function handOptionReceiptText(receipt: unknown): string | null {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const r = receipt as Record<string, unknown>;
  if (typeof r.option !== 'string' || !OPTIONS.has(r.option)) return null;
  const after = handOptionReceiptKind(r.after);
  if (after === null) return null;
  const before = r.before === null ? 'none' : handOptionReceiptKind(r.before);
  if (before === null) return null;
  return `${r.option}:${before}>${after}`;
}

/**
 * Count one executed decision's receipts into its hand. `receipts` is what a worker reply carried and is not
 * trusted: anything but a list of exact receipts adds nothing. A receipt text counts once per decision, however
 * often the reply repeats it. In memory, bounded, synchronous; never throws.
 */
export function countHandOptionReceipts(tally: Map<string, number>, receipts: unknown): void {
  try {
    if (!Array.isArray(receipts) || receipts.length === 0) return;
    const seen = new Set<string>();
    for (const receipt of receipts.slice(0, HAND_OPTION_RECEIPTS_PER_DECISION_MAX)) {
      const text = handOptionReceiptText(receipt);
      if (text === null || seen.has(text)) continue;
      seen.add(text);
      const had = tally.get(text);
      if (had === undefined && tally.size >= HAND_OPTION_RECEIPTS_PER_HAND_MAX) continue;
      tally.set(text, Math.min(HAND_OPTION_RECEIPT_DECISIONS_MAX, (had ?? 0) + 1));
    }
  } catch {
    /* a receipt is evidence; it never endangers the action being taken */
  }
}

/**
 * The hand's count as the settlement snapshot carries it to the hand save: a plain copy, or undefined when
 * nothing was counted (or the count is not there at all). Never throws: evidence never endangers a settlement.
 */
export function handOptionReceiptCounts(tally: unknown): Record<string, number> | undefined {
  try {
    if (!(tally instanceof Map) || tally.size === 0) return undefined;
    const out: Record<string, number> = {};
    for (const [receipt, n] of tally)
      if (
        typeof receipt === 'string' &&
        HAND_OPTION_RECEIPT_ROW.test(receipt) &&
        Number.isInteger(n)
      )
        out[receipt] = n;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** One row of public.ca_horse_hand_receipts. */
export interface HorseHandReceiptRow {
  hand_id: string;
  receipt: string;
  decisions: number;
}

/**
 * The rows one hand writes: one per receipt text, each re-checked against the closed row text. Empty for an
 * empty count, a missing hand id, or texts that are not receipts. Never throws.
 */
export function horseHandReceiptRows(
  handId: string,
  counts: Readonly<Record<string, number>> | null | undefined
): HorseHandReceiptRow[] {
  if (typeof handId !== 'string' || handId.length === 0 || !counts || typeof counts !== 'object')
    return [];
  const rows: HorseHandReceiptRow[] = [];
  for (const [receipt, n] of Object.entries(counts)) {
    if (rows.length >= HAND_OPTION_RECEIPTS_PER_HAND_MAX) break;
    if (!HAND_OPTION_RECEIPT_ROW.test(receipt)) continue;
    if (!Number.isInteger(n) || n < 1) continue;
    rows.push({
      hand_id: handId,
      receipt,
      decisions: Math.min(HAND_OPTION_RECEIPT_DECISIONS_MAX, n),
    });
  }
  return rows;
}
