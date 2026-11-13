/**
 * STYLE READ OFFLINE RE-RUN (pre-activation, 2026-11-13).
 *
 * The live worker's shadow is an aggregate counter (style_shadow.* keys, HorseStyleShadow.ts) with no hand, seat or
 * amount, and it is load-shaped: it re-decides at most one engaged option per decision and skips on backlog, on
 * budget and when the governor scale moved. The evaluation (phase1-verify/style-evaluation.sql) needs one row per
 * changed decision with its hand and seat, and it must not inherit those load-driven skips. This module derives the
 * rows from the decision journal instead:
 *
 *   1. replay the journaled decision exactly as it ran (exactReplay); a decision that does not replay exactly gives
 *      no row and is counted by its outcome, never substituted;
 *   2. read the switch states the decision ran with (replayState.style, v4); a v3 record ran with every option off
 *      and gives no row;
 *   3. for every option that was not off for this Horse, re-decide the same record twice through the same exact
 *      replay, once with that one option on and once with it off, every other state as recorded;
 *   4. where the two arms differ in action or amount, write one row: the committed action (`actual`), the other
 *      arm's action (`would_be`) and the arm the Horse was in.
 *
 * arm: s = the option was in shadow (off live), c = in canary and this Horse outside bucket 0 (off live),
 * o = the option was on live (on, or canary with this Horse in bucket 0); for an `o` row `would_be` is the action
 * with the option off. Measures 1 and 2 read s and c rows; o rows check the on arm against its own off arm.
 *
 * A DEEP second look replays exactly only with its original FAST record (exactReplay's originalFastRecords: the
 * earlier FAST decisions of the same producer and hand, at most 256); the script supplies them. Each row names its
 * decision (decision_id), its turn (turn_key, shared by a FAST decision and its DEEP second look), its lane and
 * whether the execution witness names it (executed), so the evaluation counts one row per executed decision.
 *
 * Nothing here writes to the journal, the database or telemetry; it runs offline on a journal copy
 * (server/scripts/style-shadow-rerun.mjs) and only on the source that made the record (exactReplay refuses others).
 */
import {
  STYLE_SWITCH_OPTIONS,
  styleSwitchDecisionOpts,
  styleSwitchStatesFrom,
  type StyleSwitchOption,
  type StyleSwitchStates,
} from '../../HorseStyleSwitch.js';
import {
  styleShadowActionCode,
  styleShadowOptionCode,
  styleShadowStreetCode,
} from '../../HorseStyleShadow.js';
import { horseMindHandFromDecision } from '../../HorseMindHandIdentity.js';
import {
  exactReplayHorseDecisionRecord,
  type HorseExactReplayOptions,
  type HorseExactReplayVerdict,
} from './exactReplay.js';

export const STYLE_SHADOW_RERUN_VERSION = 'style-shadow-rerun-v1';

/** The CSV columns, in the order style-evaluation.sql's style_shadow_decisions table declares them. */
export const STYLE_SHADOW_RERUN_COLUMNS = [
  'decision_id',
  'turn_key',
  'lane',
  'executed',
  'street_ordinal',
  'table_id',
  'hand_number',
  'seat',
  'opt',
  'street',
  'format',
  'actual',
  'would_be',
  'price',
  'confidence',
  'arm',
] as const;

export interface StyleShadowRerunRow {
  /** the journal record's own event id: one per decision, the key every evaluation join uses */
  decision_id: string;
  /** the journal turn key: a FAST decision and its DEEP second look share it */
  turn_key: string;
  lane: 'fast' | 'deep';
  /** t = the execution witness names this decision's request, f = it names another (the other lane of the turn),
   * empty = no witness joined */
  executed: 't' | 'f' | null;
  /** the Horse's own betting actions already on this street before the decision (0 = its first), from the
   * decision's action history; the evaluation finds the decision in hand_history as the (ordinal + 1)-th */
  street_ordinal: number;
  table_id: string;
  hand_number: number;
  seat: number;
  /** HorseStyleShadow option code: vb bb rr tr fr ve fb */
  opt: string;
  /** p f t r, x for anything else */
  street: string;
  format: 'cash' | 'tournament';
  /** action class codes: f k c b r a, x for anything else */
  actual: string;
  would_be: string;
  /** the call price toCall / (pot + toCall) at the decision, 0 when there was nothing to call */
  price: number;
  /** not reconstructed offline: the engaged read's confidence is not journaled (empty in the CSV) */
  confidence: null;
  arm: 's' | 'c' | 'o';
}

export type StyleShadowRerunStatus =
  /** every option was off: nothing to re-run */
  | 'all_off'
  /** the baseline did not replay exactly; the outcome is in `baseline` */
  | 'baseline_not_exact'
  /** no hand identity could be read from the decision (legacy or malformed fence) */
  | 'no_hand_identity'
  /** re-run; an option whose arms gave no decision, or whose live arm is not the recorded decision, is in
   * `failedOptions` and gives no row */
  | 'rerun'
  | 'not_a_decision';

export interface StyleShadowRerunResult {
  version: typeof STYLE_SHADOW_RERUN_VERSION;
  status: StyleShadowRerunStatus;
  baseline: HorseExactReplayVerdict['outcome'] | null;
  /** options re-run (not off for this Horse) and how many arms each produced */
  rerunOptions: StyleSwitchOption[];
  failedOptions: StyleSwitchOption[];
  rows: StyleShadowRerunRow[];
  context: HorseExactReplayVerdict['context'] | null;
  /** DECIDE_FAST or DECIDE_DEEP (a DEEP second look replays only with its original FAST record supplied) */
  lane: 'fast' | 'deep' | null;
}

const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const BETTING_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

/** The Horse's own betting actions on the decision's street before it (blinds and discards are not betting). */
function streetOrdinal(snapshot: Record<string, unknown>): number {
  const gs = obj(snapshot.gameState) ? snapshot.gameState : {};
  const player = obj(snapshot.player) ? snapshot.player : {};
  const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
  return history.filter(
    (a) =>
      obj(a) &&
      a.userId === player.user_id &&
      a.stage === gs.stage &&
      BETTING_ACTIONS.has(String(a.action))
  ).length;
}

/** Whether the joined execution witness names this decision's request (see StyleShadowRerunRow.executed). */
function executedLane(execution: unknown, snapshot: Record<string, unknown>): 't' | 'f' | null {
  if (!obj(execution) || typeof execution.body !== 'string') return null;
  try {
    const identity = (JSON.parse(execution.body) as { identity?: unknown }).identity;
    if (!obj(identity) || identity.decisionKey !== snapshot.decisionKey) return null;
    return identity.requestId === snapshot.requestId ? 't' : 'f';
  } catch {
    return null;
  }
}

function callPrice(snapshot: Record<string, unknown>): number {
  const gs = obj(snapshot.gameState) ? snapshot.gameState : {};
  const player = obj(snapshot.player) ? snapshot.player : {};
  const toCall = Number.isFinite(gs.toCall as number)
    ? Math.max(0, num(gs.toCall))
    : Math.max(0, num(gs.currentBet) - num(player.bet));
  const pot = Math.max(0, num(gs.pot));
  return toCall > 0 && pot + toCall > 0 ? Number((toCall / (pot + toCall)).toFixed(6)) : 0;
}

/** Re-run one journaled decision record; see the module comment. */
export async function styleShadowRerunRecord(
  raw: unknown,
  options: Omit<HorseExactReplayOptions, 'styleStatesOverride'>
): Promise<StyleShadowRerunResult> {
  const out: StyleShadowRerunResult = {
    version: STYLE_SHADOW_RERUN_VERSION,
    status: 'not_a_decision',
    baseline: null,
    rerunOptions: [],
    failedOptions: [],
    rows: [],
    context: null,
    lane: null,
  };
  if (!obj(raw) || raw.kind !== 'decision' || typeof raw.body !== 'string') return out;
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw.body) as unknown;
    if (!obj(parsed)) return out;
    body = parsed;
  } catch {
    return out;
  }
  const snapshotType = obj(body.snapshot) ? body.snapshot.type : null;
  out.lane =
    snapshotType === 'DECIDE_DEEP' ? 'deep' : snapshotType === 'DECIDE_FAST' ? 'fast' : null;
  const replayState = obj(body.replayState) ? body.replayState : {};
  const states = styleSwitchStatesFrom(replayState.style);
  if (!states) {
    out.status = 'all_off';
    return out;
  }
  const baseline = await exactReplayHorseDecisionRecord(raw, options);
  out.baseline = baseline.outcome;
  out.context = baseline.context;
  if (baseline.outcome !== 'replayed_exact' || !baseline.replayed) {
    out.status = 'baseline_not_exact';
    return out;
  }
  const snapshot = obj(body.snapshot) ? body.snapshot : {};
  const player = obj(snapshot.player) ? snapshot.player : {};
  const horseId = typeof player.user_id === 'string' ? player.user_id : '';
  let hand: ReturnType<typeof horseMindHandFromDecision> = null;
  try {
    hand = horseMindHandFromDecision(snapshot as never);
  } catch {
    hand = null;
  }
  if (!hand || typeof player.seat !== 'number') {
    out.status = 'no_hand_identity';
    return out;
  }
  // the Horse's treatment of each option, from the one resolver the live worker uses (the canary law: nothing else
  // reads the canary bucket)
  const live = styleSwitchDecisionOpts(states, horseId, true);
  const gs = obj(snapshot.gameState) ? snapshot.gameState : {};
  const format: 'cash' | 'tournament' =
    gs.gameMode === 'tournament' || obj(gs.tournament) ? 'tournament' : 'cash';
  const street = styleShadowStreetCode(String(gs.stage ?? ''));
  const price = callPrice(snapshot);
  const ordinal = streetOrdinal(snapshot);
  out.status = 'rerun';
  for (const option of STYLE_SWITCH_OPTIONS) {
    const state = states[option];
    if (state === 'off') continue;
    out.rerunOptions.push(option);
    const liveOn = live[option] === true;
    const arm = async (s: 'on' | 'off') =>
      (
        await exactReplayHorseDecisionRecord(raw, {
          ...options,
          styleStatesOverride: { ...states, [option]: s } as StyleSwitchStates,
        })
      ).replayed;
    const [withOn, withOff] = [await arm('on'), await arm('off')];
    if (!withOn || !withOff) {
      out.failedOptions.push(option);
      continue;
    }
    // the arm the Horse ran must be the recorded decision (the baseline), or the re-run is not the live decision
    const committed = liveOn ? withOn : withOff;
    const other = liveOn ? withOff : withOn;
    if (
      committed.action !== baseline.replayed.action ||
      committed.amount !== baseline.replayed.amount
    ) {
      out.failedOptions.push(option);
      continue;
    }
    if (other.action === committed.action && (other.amount ?? 0) === (committed.amount ?? 0))
      continue;
    out.rows.push({
      decision_id: String(raw.eventId ?? ''),
      turn_key: String(raw.turnKey ?? ''),
      lane: snapshot.type === 'DECIDE_DEEP' ? 'deep' : 'fast',
      executed: executedLane(options.execution, snapshot),
      street_ordinal: ordinal,
      table_id: hand.tableId,
      hand_number: hand.handNumber,
      seat: player.seat,
      opt: styleShadowOptionCode(option),
      street,
      format,
      actual: styleShadowActionCode(committed.action),
      would_be: styleShadowActionCode(other.action),
      price,
      confidence: null,
      arm: liveOn ? 'o' : (live.styleCanaryOptions ?? []).includes(option) ? 'c' : 's',
    });
  }
  return out;
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const styleShadowRerunCsvHeader = (): string => STYLE_SHADOW_RERUN_COLUMNS.join(',');
export const styleShadowRerunCsvLine = (row: StyleShadowRerunRow): string =>
  STYLE_SHADOW_RERUN_COLUMNS.map((c) => csvCell(row[c])).join(',');
