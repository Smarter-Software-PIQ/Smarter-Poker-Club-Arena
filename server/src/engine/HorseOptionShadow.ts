/**
 * SHADOW FOR A NON-STYLE OPTION: THE COUNTERFACTUAL RECEIPT (2026-11-18, Horse Switch lane).
 *
 * An option switched to `shadow` (HorseOptionSwitch.OPTION_SWITCH_SHADOW_NAMES) passes nothing to the brain, so the
 * acted decision is made exactly as with no row. After the committed decision is final and before it is journaled
 * and sent, the decision worker (workerRuntime.optionShadowReceipt) decides the same request ONCE more with the one
 * picked option flipped: the style action-receipt mechanism (same RNG position, committed governor scale, counters
 * suspended, once-per-decision receipts suppressed, observation off, Horse-memory effects captured and discarded,
 * RNG and per-decision registries restored after). The result is never acted on. It is recorded as:
 *  - the journal field HorseDecision.optionShadowReceipt (version 1, below): option, the value it was flipped to,
 *    changed, the actual and the counterfactual action and amount, street, variant, format, and whether a person
 *    (a seat that is not a Horse) was dealt into the hand and still in it;
 *  - option_shadow_<option>_changed_seen / option_shadow_<option>_same_seen, and the person-present subset
 *    option_shadow_<option>_changed_person_seen / option_shadow_<option>_same_person_seen (Horse-only = all minus
 *    person), so the daily telemetry can be read without the journal (docs/sql/horse-option-shadow-summary.sql).
 *
 * BUDGET (latency must not regress): at most one re-decision per decision (several options in shadow rotate by the
 * decision key), never with work queued behind the decision, never once the decision has spent the 15 ms shadow
 * budget, only at the committed governor scale, and at most OPTION_SHADOW_PER_MINUTE_DEFAULT re-decisions per
 * worker per clock minute (HORSE_OPTION_SHADOW_PER_MINUTE, 0 stops them). Every skip is counted.
 *
 * PEOPLE FIRST (2026-11-21, Horse SWITCH lane). What the owner asks of a rule is how it plays against people, and
 * fewer than 1 decision in 100 has a person dealt in (v16Ratio, Nov 20-21: 163 of 22,374 re-decisions). So the
 * per-minute budget never refuses a decision with a person dealt in (OptionShadowBudget.admit): it takes a slot of
 * the minute like any other, and the Horse-only decisions after it in that minute are the ones dropped. The latency
 * guards are not changed and hold for everyone: no re-decision with work queued behind the decision, none once the
 * decision has spent its acted-time budget, none at a moved governor scale; and 0 still stops every re-decision.
 * Every skip is counted, and its person-present subset too: option_shadow_skipped_<reason>_person_seen
 * (reason backlog | budget | scale | stage_disabled | rate; rate fires only at 0). A person decision re-decided after
 * the minute's slots were spent is counted option_shadow_rate_person_over_seen.
 */

/** What one shadow re-decision recorded (journal field HorseDecision.optionShadowReceipt). */
export interface OptionShadowReceipt {
  version: 1;
  option: string;
  /** The value the re-decision passed for the option: the opposite of the acted value. */
  flippedTo: boolean;
  /** True exactly when the counterfactual action or amount differs from the acted one. */
  changed: boolean;
  actual: { action: string; amount: number | null };
  /** Null when the re-decision failed or ran at another governor scale (then changed is false, nothing counted). */
  would: { action: string; amount: number | null } | null;
  street: string;
  variant: string;
  format: 'cash' | 'tournament';
  /** A seat that is not a Horse was dealt into this hand (is_horse not true; unknown counts as a person). */
  personDealt: boolean;
  /** ... and had not folded when this decision was made. */
  personLive: boolean;
}

/** Re-decisions per worker per clock minute when HORSE_OPTION_SHADOW_PER_MINUTE is not set. */
export const OPTION_SHADOW_PER_MINUTE_DEFAULT = 12;
export const OPTION_SHADOW_PER_MINUTE_MAX = 600;

/** The configured per-minute budget: a whole number 0..600, else the default. */
export function optionShadowPerMinute(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === '')
    return OPTION_SHADOW_PER_MINUTE_DEFAULT;
  if (!/^\d{1,4}$/.test(raw.trim())) return OPTION_SHADOW_PER_MINUTE_DEFAULT;
  const n = Number(raw.trim());
  return n <= OPTION_SHADOW_PER_MINUTE_MAX ? n : OPTION_SHADOW_PER_MINUTE_DEFAULT;
}

/**
 * A fixed one-minute window shared by every option in shadow of this worker. take() answers true at most `perMinute`
 * times per window of the given clock for a Horse-only decision. PEOPLE FIRST: a decision with a person dealt in is
 * always admitted (unless perMinute is 0, the stop) and takes a slot, so it is the Horse-only decisions that are
 * dropped when the minute is full. admit() says whether a person decision came within the minute's slots or over them.
 */
export class OptionShadowBudget {
  private window = Number.NaN;
  private used = 0;
  constructor(private readonly perMinute: number) {}
  take(nowMs: number, personDealt = false): boolean {
    return this.admit(nowMs, personDealt) !== null;
  }
  /** null: refused (a Horse-only decision over the minute's slots, or the budget is 0 or the clock unreadable). */
  admit(nowMs: number, personDealt = false): 'within' | 'person_over' | null {
    if (!(this.perMinute > 0) || !Number.isFinite(nowMs)) return null;
    const w = Math.floor(nowMs / 60_000);
    if (w !== this.window) {
      this.window = w;
      this.used = 0;
    }
    if (this.used >= this.perMinute) {
      if (!personDealt) return null;
      this.used++;
      return 'person_over';
    }
    this.used++;
    return 'within';
  }
}

/** The one option in shadow a decision re-decides: FNV-1a of the decision key (as styleActionReceiptPick). */
export function optionShadowPick(options: readonly string[], decisionKey: string): string | null {
  if (options.length === 0) return null;
  let h = 0x811c9dc5;
  const key = String(decisionKey);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return options[h % options.length]!;
}

interface SeatLike {
  readonly user_id?: string;
  readonly seat?: number;
  readonly is_horse?: boolean;
  readonly is_folded?: boolean;
  readonly is_sitting_out?: boolean;
  readonly cards?: readonly unknown[];
}

/** Whether a person (any seat that is not a Horse) was dealt in, and is still in, from the decision's own state. */
export function optionShadowPersonPresence(
  gameState: { readonly players?: readonly SeatLike[]; readonly dealtSeatIds?: readonly number[] },
  heroUserId: string
): { personDealt: boolean; personLive: boolean } {
  const dealt = Array.isArray(gameState.dealtSeatIds) ? gameState.dealtSeatIds : null;
  let personDealt = false;
  let personLive = false;
  for (const p of gameState.players ?? []) {
    if (!p || p.user_id === heroUserId || p.is_horse === true || p.is_sitting_out === true)
      continue;
    const inHand = dealt
      ? typeof p.seat === 'number' && dealt.includes(p.seat)
      : (Array.isArray(p.cards) && p.cards.length > 0) || p.is_folded === false;
    if (!inHand) continue;
    personDealt = true;
    if (p.is_folded !== true) personLive = true;
  }
  return { personDealt, personLive };
}

const amountOf = (d: { amount?: number }): number | null =>
  typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : null;

/** Build the receipt from the acted decision and the counterfactual one. */
export function optionShadowReceiptOf(input: {
  option: string;
  flippedTo: boolean;
  actual: { action: string; amount?: number };
  would: { action: string; amount?: number } | null;
  street: string;
  variant: string;
  format: 'cash' | 'tournament';
  personDealt: boolean;
  personLive: boolean;
}): OptionShadowReceipt {
  const a = { action: String(input.actual.action), amount: amountOf(input.actual) };
  const w = input.would
    ? { action: String(input.would.action), amount: amountOf(input.would) }
    : null;
  return {
    version: 1,
    option: input.option,
    flippedTo: input.flippedTo,
    changed: w !== null && (w.action !== a.action || (w.amount ?? 0) !== (a.amount ?? 0)),
    actual: a,
    would: w,
    street: String(input.street),
    variant: String(input.variant || 'nlh'),
    format: input.format,
    personDealt: input.personDealt,
    personLive: input.personLive,
  };
}

/** The counters of one receipt: changed or same, and the person-present subset. */
export function optionShadowCounterKeys(receipt: OptionShadowReceipt): string[] {
  if (!receipt.would) return [];
  const outcome = receipt.changed ? 'changed' : 'same';
  const keys = [`option_shadow_${receipt.option}_${outcome}_seen`];
  if (receipt.personDealt) keys.push(`option_shadow_${receipt.option}_${outcome}_person_seen`);
  return keys;
}
