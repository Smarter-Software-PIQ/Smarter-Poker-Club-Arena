/**
 * STYLE READ SHADOW (2026-11-13): an option in shadow computes what it would have done and changes nothing.
 *
 * A consumer asks `opts.<option> === true ? 'on' : styleShadowArm(opts, option)`: 'on' (explicitly true: it acts,
 * as before), 'shadow' (listed in opts.styleShadow: it computes its adjustment and does NOT apply it; when the adjustment is not
 * neutral it records that the option ENGAGED), or null (off: nothing is computed). The worker then re-decides the
 * same request with that one option on (same RNG position, effects captured and discarded) and records a shadow
 * receipt only when the would-be action differs from the committed one.
 *
 * Shadow never draws from the random stream (the style read is deterministic) and never writes Horse memory.
 * Allocation is bounded per decision: at most one entry per option (seven).
 */
import type { StyleSwitchOption } from './HorseStyleSwitch.js';

export type StyleArm = 'on' | 'shadow' | null;

/**
 * 'shadow' when the option is listed in opts.styleShadow, else null. A consumer keeps its own explicit gate first:
 * `opts.<option> === true ? 'on' : styleShadowArm(opts, '<option>')`, so on stays the explicit true it always was.
 */
export function styleShadowArm(
  opts: { readonly styleShadow?: readonly string[] },
  option: StyleSwitchOption
): 'shadow' | null {
  const list = opts.styleShadow;
  return Array.isArray(list) && list.includes(option) ? 'shadow' : null;
}

/** What one engaged option recorded: the read confidence (confidenceCap of the read it used). */
export interface StyleShadowEngagement {
  option: StyleSwitchOption;
  confidence: number;
}

const engaged = new Map<StyleSwitchOption, StyleShadowEngagement>();

/** Record that an option in shadow would have changed its input to the decision. First note per option wins. */
export function noteStyleShadowEngaged(option: StyleSwitchOption, confidence: number): void {
  if (engaged.has(option)) return;
  engaged.set(option, {
    option,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  });
}

/** Take (and clear) what the last decision recorded. */
export function takeStyleShadowEngaged(): StyleShadowEngagement[] {
  const out = [...engaged.values()];
  engaged.clear();
  return out;
}

export function clearStyleShadowEngaged(): void {
  engaged.clear();
}

/** The style read's own time inside one decision (HorseMind.styleRead), in ms, for the latency budget. */
let styleReadMs = 0;
export function addStyleReadMs(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) styleReadMs += ms;
}
export function takeStyleReadMs(): number {
  const v = styleReadMs;
  styleReadMs = 0;
  return v;
}

/** The pre-registered latency budget of the style read per decision (EVALUATION-PREREGISTRATION.md). */
export const STYLE_READ_BUDGET_MS = 0.25;

const OPTION_CODE: Record<StyleSwitchOption, string> = {
  styleValueBettorNotManiac: 'vb',
  styleBigBetHonesty: 'bb',
  styleRaiseRespect: 'rr',
  styleTightReRaiserRespect: 'tr',
  styleFoldRatePreRepair: 'fr',
  styleValueExtraction: 've',
  styleFoldBluff: 'fb',
};
export const STYLE_SHADOW_OPTION_CODES: Readonly<Record<string, StyleSwitchOption>> = Object.freeze(
  Object.fromEntries(Object.entries(OPTION_CODE).map(([o, c]) => [c, o as StyleSwitchOption]))
);
const ACTION_CODE: Record<string, string> = {
  fold: 'f',
  check: 'k',
  call: 'c',
  bet: 'b',
  raise: 'r',
  all_in: 'a',
  allin: 'a',
};
const STREET_CODE: Record<string, string> = { preflop: 'p', flop: 'f', turn: 't', river: 'r' };

export interface StyleShadowReceipt {
  option: StyleSwitchOption;
  format: 'cash' | 'tournament';
  variant: string;
  street: string;
  actual: { action: string; amount: number };
  wouldBe: { action: string; amount: number };
  /** the call price of the decision: toCall / (pot + toCall), 0 when nothing to call */
  price: number;
  confidence: number;
  /** 'shadow', or the canary bucket the Horse is in when the option is in canary */
  arm: 'shadow' | 'canary';
  bucket: number | null;
  /** where the hand result joins: hand_history (table_id, hand_number) and the Horse's seat */
  tableId: string;
  handNumber: number;
  seat: number;
}

/**
 * The receipt as one brain-telemetry key (horse_brain_telemetry.feature, at most 128 characters, fires = 1 per
 * changed decision), so the evaluation reads it from existing telemetry with no new table:
 *
 *   style_shadow.<opt>.<c|t>.<variant>.<street>.<actual>.<wouldBe>.<price%>.<conf%>.<s|cN>.<table32>.<hand>.<seat>_seen
 *
 * opt: vb bb rr tr fr ve fb; actions: f k c b r a, with the amount in big blinds x100 after a colon when it is a
 * bet or raise; price and confidence are whole percent; s = shadow, cN = canary bucket N; table32 is the table id
 * without dashes. Returns null when the key would not fit (the receipt is then counted as unencodable).
 */
export function styleShadowReceiptKey(r: StyleShadowReceipt, bigBlind: number): string | null {
  const act = (a: { action: string; amount: number }) => {
    const c = ACTION_CODE[a.action] ?? 'x';
    return c === 'b' || c === 'r' || c === 'a'
      ? `${c}:${Math.round((Number(a.amount) || 0) * (100 / Math.max(1e-9, bigBlind)))}`
      : c;
  };
  const pct = (x: number) => String(Math.round(Math.max(0, Math.min(1, x)) * 100));
  const table = String(r.tableId).toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(table)) return null;
  if (!Number.isSafeInteger(r.handNumber) || r.handNumber < 0) return null;
  if (!Number.isSafeInteger(r.seat) || r.seat < 0 || r.seat > 99) return null;
  if (!/^[a-z0-9]{1,8}$/.test(r.variant)) return null;
  const key = [
    'style_shadow',
    OPTION_CODE[r.option],
    r.format === 'tournament' ? 't' : 'c',
    r.variant,
    STREET_CODE[r.street] ?? 'x',
    act(r.actual),
    act(r.wouldBe),
    pct(r.price),
    pct(r.confidence),
    r.arm === 'canary' ? `c${r.bucket ?? 'x'}` : 's',
    table,
    String(r.handNumber),
    String(r.seat),
  ].join('.');
  const full = `${key}_seen`;
  return full.length <= 128 ? full : null;
}
