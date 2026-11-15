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
  liveEngaged.clear();
}

/**
 * LIVE ENGAGEMENT RECEIPTS (2026-11-15): what an option that is ON recorded when its adjustment actually applied (the
 * same non-neutral condition its shadow arm records under). Kept apart from the shadow record, so the shadow
 * re-decision is exactly what it was. The worker reads it after the committed decision only to count engagement by
 * format (style_engaged_*); nothing re-decides because of it. Telemetry only: recording reads nothing new and changes
 * nothing in the decision. Bounded: at most one entry per option (seven).
 */
const liveEngaged = new Map<StyleSwitchOption, StyleShadowEngagement>();

/**
 * Record that a style option engaged in the arm it ran in: 'on' (it applied its adjustment) or 'shadow' (exactly
 * noteStyleShadowEngaged). First note per option and arm wins.
 */
export function noteStyleEngaged(
  option: StyleSwitchOption,
  confidence: number,
  arm: 'on' | 'shadow'
): void {
  if (arm === 'shadow') {
    noteStyleShadowEngaged(option, confidence);
    return;
  }
  if (liveEngaged.has(option)) return;
  liveEngaged.set(option, {
    option,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  });
}

/** Take (and clear) what the last decision recorded for the options that are ON. */
export function takeStyleLiveEngaged(): StyleShadowEngagement[] {
  const out = [...liveEngaged.values()];
  liveEngaged.clear();
  return out;
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
/** The variants a shadow receipt names; any other variant is counted as `other` (a fixed key set). */
export const STYLE_SHADOW_VARIANTS = Object.freeze([
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
  'flh',
  'pineapple',
  'short_deck',
] as const);

/** The engagement receipt format: tournament, else Lightning (publicMemoryDomain.speed), else Classic cash. */
export type StyleReceiptFormat = 'cash' | 'tournament' | 'lightning';

/**
 * The format an engagement receipt (style_engaged_*) names for a game state: `tournament` for a tournament, `lightning`
 * for a game whose public memory domain is Lightning speed, `cash` otherwise. Lightning is cash, so the shadow receipt
 * (styleShadowAggregateKey, c|t) counts it under `c`; the engagement receipt tells it apart from Classic cash.
 */
export function styleReceiptFormat(gs: {
  readonly gameMode?: unknown;
  readonly tournament?: unknown;
  readonly publicMemoryDomain?: { readonly speed?: unknown } | null;
}): StyleReceiptFormat {
  if (gs.gameMode === 'tournament' || gs.tournament) return 'tournament';
  return gs.publicMemoryDomain?.speed === 'lightning' ? 'lightning' : 'cash';
}

const FORMAT_CODE: Record<StyleReceiptFormat, string> = {
  cash: 'c',
  tournament: 't',
  lightning: 'l',
};
/** The format code of an engagement receipt: c (Classic cash), t (tournament), l (Lightning). */
export function styleReceiptFormatCode(format: StyleReceiptFormat): string {
  return FORMAT_CODE[format] ?? 'c';
}

/** What a changed shadow decision is counted under. */
export interface StyleShadowReceipt {
  option: StyleSwitchOption;
  format: 'cash' | 'tournament';
  variant: string;
  street: string;
  actualAction: string;
  wouldBeAction: string;
  /** 'canary' when THIS option is in canary for the Horse (it is then in its shadow arm), else 'shadow' */
  arm: 'shadow' | 'canary';
}

/**
 * H1 (review 64466c83): the receipt is an AGGREGATE counter over a fixed key set, never one key per decision:
 *
 *   style_shadow.<opt>.<c|t>.<variant>.<p|f|t|r>.<actual>.<wouldBe>.<s|c>_seen
 *
 * opt: vb bb rr tr fr ve fb; variant: one of STYLE_SHADOW_VARIANTS or `other`; actions: the action class only
 * (f k c b r a, x for anything else), no amount; the street is p f t r, or x for anything else. At most
 7 x 2 x 10 x 5 x 7 x 7 x 2 = 68,600 keys exist, whatever the volume (above the writer's 4,096 per batch, so the
 publisher splits batches: phase1-verify/telemetry-publisher-bounded-batches.patch).
 * The per-decision detail (hand, seat, amounts) is not in telemetry: the evaluation reconstructs it from the decision
 * journal, whose record carries the switch state the decision ran with (M3), joined to ca_hand_facts
 * (phase1-verify/style-evaluation.sql).
 */
export function styleShadowAggregateKey(r: StyleShadowReceipt): string {
  const variant = (STYLE_SHADOW_VARIANTS as readonly string[]).includes(r.variant)
    ? r.variant
    : 'other';
  return (
    [
      'style_shadow',
      OPTION_CODE[r.option],
      r.format === 'tournament' ? 't' : 'c',
      variant,
      STREET_CODE[r.street] ?? 'x',
      ACTION_CODE[r.actualAction] ?? 'x',
      ACTION_CODE[r.wouldBeAction] ?? 'x',
      r.arm === 'canary' ? 'c' : 's',
    ].join('.') + '_seen'
  );
}

/**
 * M2: the cap on the shadow re-decision. One re-decision per decision at most; it is skipped (with a receipt) when
 * the committed decision itself took longer than this, since the re-decision costs about the same.
 */
export const STYLE_SHADOW_REDECIDE_BUDGET_MS = 15;

/**
 * M2: the one engaged option a decision re-decides, chosen deterministically from the decision key (a 32-bit FNV-1a
 * hash), so every option is sampled across decisions and a replay picks the same one.
 */
export function styleShadowPick(
  engaged: readonly StyleShadowEngagement[],
  decisionKey: string
): StyleShadowEngagement | null {
  if (engaged.length === 0) return null;
  let h = 0x811c9dc5;
  const key = String(decisionKey);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return engaged[h % engaged.length]!;
}

/** The receipt codes, for the offline re-run (styleShadowRerun) and the evaluation CSV. */
export function styleShadowOptionCode(option: StyleSwitchOption): string {
  return OPTION_CODE[option];
}
export function styleShadowActionCode(action: string): string {
  return ACTION_CODE[action] ?? 'x';
}
export function styleShadowStreetCode(street: string): string {
  return STREET_CODE[street] ?? 'x';
}
