import { validMultiwayRiverState, type MultiwayRiverReadState } from './HorseMultiwayRiverRead.js';
import { MEMORY_VARIANTS, opponentMemoryKey } from './HorseOpponentMemory.js';
import { type HorseWinnerReadRow } from './HorseWinnerRead.js';
import {
  horsePlanContextIsValid,
  horsePlanContextKey,
  type HorsePlanContext,
} from './HorsePlanHandIdentity.js';
import { createHash } from 'node:crypto';
import {
  HorseMind,
  type HorseMindSandbox,
  type OpponentStats,
  type PooledRowProvenance,
  type RaiseResponsePlan,
} from './HorseMind.js';
import type { SeatPlayer } from '../types.js';
import {
  POSTFLOP_BETS_ROW_LENGTH,
  postflopBetsFromRow,
  postflopBetsRow,
  validPostflopBets,
  type PostflopBetCounters,
} from './HorsePostflopBetRecord.js';
import {
  EXPLOIT_COUNTER_FIELDS,
  EXPLOIT_LONG_FIELDS,
  hasLongParticipation,
  type ExploitCounters,
  type ExploitCountersWithLong,
  type FlopStabCounters,
} from './HorseOpponentExploit.js';
import { PRE_REPAIR_STATS } from './HorseOpponentStyle.js';
import {
  SHOWN_RIVER_ROW_LENGTH,
  shownRiverReadFromRow,
  shownRiverRow,
  validShownRiverRead,
  type ShownRiverRead,
} from './HorseLongShownMemory.js';
import {
  STREET_READ_ROW_LENGTH,
  streetReadFromRow,
  streetReadRow,
  validStreetRead,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import {
  RERAISE_RESPONSE_ROW_LENGTH,
  reraiseResponseFromRow,
  reraiseResponseRow,
  validReraiseResponse,
  type ReraiseResponseCounters,
} from './HorseOmahaReraiseResponse.js';
import {
  FLOP_SHOWN_ROW_LENGTH,
  flopShownFromRow,
  flopShownRow,
  validFlopShown,
  type FlopShownCounters,
} from './HorseOmahaFlopShown.js';
import {
  STREET_PRICE_ROW_LENGTH,
  streetPriceFromRow,
  streetPriceRow,
  validStreetPrice,
  type StreetPriceCounters,
} from './HorseOmahaStreetReadPrice.js';
import {
  normalizeHorseObservationWindow,
  type HorseObservationWindow,
} from './HorseObservationWindow.js';

/** Private portable read component, not a complete runtime checkpoint. Only
 * valid with observation disabled and speculative effects captured. Never
 * include this frame in public state, health, telemetry or worker replies. */
export interface HorseDecisionReadFrame {
  readonly version:
    | 'horse-decision-reads-v1'
    | 'horse-decision-reads-v2'
    | 'horse-decision-reads-v3'
    | 'horse-decision-reads-v4'
    | 'horse-decision-reads-v5'
    | 'horse-decision-reads-v6'
    | 'horse-decision-reads-v7'
    | 'horse-decision-reads-v8'
    | 'horse-decision-reads-v9'
    | 'horse-decision-reads-v10'
    | 'horse-decision-reads-v11'
    | 'horse-decision-reads-v12'
    | 'horse-decision-reads-v13'
    | 'horse-decision-reads-v14'
    | 'horse-decision-reads-v15'
    | 'horse-decision-reads-v16'
    | 'horse-decision-reads-v17'
    | 'horse-decision-reads-v18'
    | 'horse-decision-reads-v19'
    | 'horse-decision-reads-v20'
    | 'horse-decision-reads-v22';
  readonly bytes: number;
  readonly sha256: string;
  readonly json: string;
}
export const HORSE_DECISION_READ_FRAME_MAX_BYTES = 256 * 1024;
const VERSION = 'horse-decision-reads-v1';
const ALLOCATED_VERSION = 'horse-decision-reads-v2';
const WINDOW_VERSION = 'horse-decision-reads-v3';
/** 2026-10-16: v3 plus the decayed opponent-exploit counters. Written only
 * when the view carries any, so every earlier frame keeps its exact bytes. */
const EXPLOIT_VERSION = 'horse-decision-reads-v4';
const WINNER_VERSION = 'horse-decision-reads-v5';
/** 2026-10-25: v5 plus the river-call counters (riverCallSD/riverCallSDWeak),
 * carried in their own row lists beside the stat rows. Written only when a
 * captured row has a non-zero river-call counter, so every frame without one
 * keeps its exact v1-v5 bytes, and a v1-v5 frame decodes with both at 0. A v6
 * frame always carries winnerReads; a view without winner evidence travels as
 * an empty list, which a sandbox reads exactly like an absent one. */
const RIVER_CALL_VERSION = 'horse-decision-reads-v6';
/** V7 appends the conditional public river opportunities to the sidecar only.
 * Zero/absent new evidence preserves exact predecessor bytes. */
const RIVER_POSITION_VERSION = 'horse-decision-reads-v7';
const RIVER_RAISE_VERSION = 'horse-decision-reads-v8';
const MULTIWAY_RIVER_VERSION = 'horse-decision-reads-v9';
/** 2026-11-07: v9 plus the fast call-down river recency window
 * (OpponentStats.rvOpps / rvCalls, HorseFastCalldownRead.ts), carried for the
 * rows that hold one so a second look prices exactly the read the first did.
 * Written only when a captured row carries the window, so every earlier frame
 * keeps its exact bytes. A v10 body always carries the v9 lists (empty when
 * there is no multiway river evidence). */
const FAST_CALLDOWN_VERSION = 'horse-decision-reads-v10';
/** 2026-11-08: v10 plus the probe-bet tallies (OpponentStats.ctBets /
 * ctProbes, PROBE BETS ARE NOT AGGRESSION), carried for the pooled rows that
 * hold them so a second look reads the aggressor exactly as the first did.
 * Written only when a captured pooled row carries the tallies, so every
 * earlier frame keeps its exact bytes. A v11 body always carries the v10 lists
 * (empty when there is no river recency window). */
const PROBE_VERSION = 'horse-decision-reads-v11';
/** 2026-11-07: v11 plus the limp-reraise tallies (OpponentStats.lrOpps /
 * lrRaises, HorseLimpReraiseRead), carried for the pooled rows that hold them
 * so a second look reads the limper exactly as the first did. Written only
 * when a captured pooled row carries the tallies, so every earlier frame
 * keeps its exact bytes. A v12 body always carries the v11 lists (the probe
 * list may be empty). */
const LIMP_RERAISE_VERSION = 'horse-decision-reads-v12';
/** 2026-11-11: v12 plus flop checked-to stab counters (`view.flopStab`,
 * V87 Bully-Breaker `FlopStabCounters`), including low and empty rows: the
 * presence of a flop-specific row suppresses fallback to pooled street reads.
 * so a `DECIDE_DEEP` second look reads the exact same street-specific Bully-Breaker
 * read as `DECIDE_FAST`. Written only when a flop-stab row is present,
 * preserving exact v1-v12 bytes for snapshots without flop-specific evidence. */
const FLOP_STAB_VERSION = 'horse-decision-reads-v13';
/** 2026-11-14: v13 plus the pre-repair provenance of the pooled public rows the decision read
 * (`view.pooledProvenance`, HorseMind.pooledRowProvenance): for each pre-repair keyed row, its keying and its
 * post-release opportunity counts, so a `DECIDE_DEEP` second look and an exact replay apply the same pre-repair
 * discount `DECIDE_FAST` did. Written only when the view carries such a row (a cash table-speed pooled row, or a cash
 * pooled row with no public domain on file), so every snapshot without one keeps its exact v1-v13 bytes. A v14 body
 * always carries the v13 lists; its flop-stab list may be empty (a v13 body's never is). */
const PRE_REPAIR_VERSION = 'horse-decision-reads-v14';
/** 2026-11-15: v14 plus the long participation window of the exploit rows the decision read (`exploitLong`:
 * [lHands, lVpip, lPfr] per exploit row that carries one, HorseOpponentExploit.EXPLOIT_LONG_FIELDS), so a
 * `DECIDE_DEEP` second look and an exact replay read VPIP and PFR from the same 120-hand evidence `DECIDE_FAST`
 * did. Written only when a row carries the window, so every snapshot without one keeps its exact v1-v14 bytes. A
 * v15 body always carries the v14 lists; its provenance and flop-stab lists may be empty. */
const LONG_PARTICIPATION_VERSION = 'horse-decision-reads-v15';
/** 2026-11-15: v15 plus the durable shown river reads the decision carried (`shownRiver`: per pooled exact row whose
 * record reached the decision behind styleLongShownMemory, [older, then bets, shown, strong per size bucket],
 * HorseLongShownMemory.shownRiverRow), so a `DECIDE_DEEP` second look and an exact replay read the same river size
 * buckets `DECIDE_FAST` did. Written only when the view carries such a read (never with the option off), so every
 * snapshot without one keeps its exact v1-v15 bytes. A v16 body always carries the v15 lists; its long, provenance
 * and flop-stab lists may be empty. */
const SHOWN_RIVER_VERSION = 'horse-decision-reads-v16';
/** 2026-11-15: v16 plus the pooled rows whose stored profile is not complete (`incompleteProfiles`: [1] per pooled
 * exact or donor row that failed HorseOpponentStyle.profileQualification), carried only behind
 * holdemProfileCompletenessCap, so a `DECIDE_DEEP` second look and an exact replay apply the same completeness cap
 * `DECIDE_FAST` did. Written only when the view carries such a row (never with the option off), so every snapshot
 * without one keeps its exact v1-v16 bytes. A v17 body always carries the v16 lists; they may be empty. */
const PROFILE_COMPLETENESS_VERSION = 'horse-decision-reads-v17';
/** 2026-11-17: v17 plus the postflop read by street and flop texture of the pooled exact rows the decision carried
 * (`streetRead`: per Omaha row with a durable street read, [hit, opp] for each of its 17 cells,
 * HorseOmahaStreetRead.streetReadRow), so a `DECIDE_DEEP` second look and an exact replay carry the same record
 * `DECIDE_FAST` did. No decision reads it yet. Written only when the view carries such a row (never for a Hold'em
 * decision, never before the column holds a record), so every snapshot without one keeps its exact v1-v17 bytes. A
 * v18 body always carries the v17 lists; they may be empty, and it carries at least one street row. */
const STREET_READ_VERSION = 'horse-decision-reads-v18';
/** 2026-11-18: v18 plus how the pooled exact rows' players answer a raise of their own re-raise
 * (`reraiseResponse`: per Omaha row with a durable record, [opp, fold, call, raise] of each of its two nodes,
 * HorseOmahaReraiseResponse.reraiseResponseRow), so a `DECIDE_DEEP` second look and an exact replay carry the same
 * record `DECIDE_FAST` did. Written only when the view carries such a row (never for a Hold'em decision, never
 * before the column holds a record), so every snapshot without one keeps its exact v1-v18 bytes. A v19 body always
 * carries the v17 lists and the v18 street list; they may be empty, and it carries at least one response row. */
const RERAISE_RESPONSE_VERSION = 'horse-decision-reads-v19';
const reraiseResponseCarried = (version: unknown) => version === RERAISE_RESPONSE_VERSION;
/** 2026-11-19: v19 plus two records of the pooled exact rows' players: what they showed after betting a flop and
 * what calls of those bets returned (`flopShown`: per Omaha row with a durable record, its 80 integers,
 * HorseOmahaFlopShown.flopShownRow), and the price behind their fold-to-raise cells (`streetPrice`: per Omaha row
 * with a durable record, [sum, opp] of each street, HorseOmahaStreetReadPrice.streetPriceRow), so a `DECIDE_DEEP`
 * second look and an exact replay carry the same records `DECIDE_FAST` did. Written only when the view carries
 * such a row (never for a Hold'em decision, never before a column holds a record), so every snapshot without one
 * keeps its exact v1-v19 bytes. A v20 body always carries the v17 lists, the v18 street list, the v19 response
 * list and both of its own lists; any of them may be empty, but not both of its own. No decision reads either
 * record. */
const FLOP_SHOWN_VERSION = 'horse-decision-reads-v20';
const flopShownCarried = (version: unknown) => version === FLOP_SHOWN_VERSION;
/** 2026-11-25: v20 plus how the pooled exact rows' NLH players answer a postflop bet and what their called bets
 * showed (`postflopBets`: per nlh row with a durable record, its 30 numbers, HorsePostflopBetRecord.postflopBetsRow),
 * so a `DECIDE_DEEP` second look and an exact replay carry the same record `DECIDE_FAST` did. Written only when the
 * view carries such a row (never before the column holds a record), so every snapshot without one keeps its exact
 * v1-v20 bytes. A v22 body always carries every v17-v20 list (any of them may be empty) and at least one
 * postflopBets row. (v21 is the opener-response frame of a sibling branch; whichever lands second renumbers.) */
const POSTFLOP_BETS_VERSION = 'horse-decision-reads-v22';
const postflopBetsCarried = (version: unknown) => version === POSTFLOP_BETS_VERSION;
/** The body carries the `flopShown` and `streetPrice` lists (v20: not both empty; v22: possibly both empty). */
const flopShownListed = (version: unknown) =>
  flopShownCarried(version) || postflopBetsCarried(version);
/** The body carries a `reraiseResponse` list (v19: at least one row; v20 and v22: possibly empty). */
const reraiseResponseListed = (version: unknown) =>
  reraiseResponseCarried(version) || flopShownListed(version);
/** The body carries a `streetRead` list (v18: at least one row; v19 and v20: possibly empty). */
const streetReadListed = (version: unknown) =>
  version === STREET_READ_VERSION || reraiseResponseListed(version);
const streetReadCarried = (version: unknown) => version === STREET_READ_VERSION;
const profileCompleted = (version: unknown) =>
  version === PROFILE_COMPLETENESS_VERSION || streetReadListed(version);
const shownRivered = (version: unknown) =>
  version === SHOWN_RIVER_VERSION || profileCompleted(version);
const longParticipated = (version: unknown) =>
  version === LONG_PARTICIPATION_VERSION || shownRivered(version);
const preRepaired = (version: unknown) =>
  version === PRE_REPAIR_VERSION || longParticipated(version);
const flopStabbed = (version: unknown) => version === FLOP_STAB_VERSION || preRepaired(version);
const limpReraised = (version: unknown) => version === LIMP_RERAISE_VERSION || flopStabbed(version);
const probed = (version: unknown) => version === PROBE_VERSION || limpReraised(version);
const recencied = (version: unknown) => version === FAST_CALLDOWN_VERSION || probed(version);
const multiwayed = (version: unknown) => version === MULTIWAY_RIVER_VERSION || recencied(version);
const raised = (version: unknown) => version === RIVER_RAISE_VERSION || multiwayed(version);
const positioned = (version: unknown) => version === RIVER_POSITION_VERSION || raised(version);
const rivered = (version: unknown) => version === RIVER_CALL_VERSION || positioned(version);
const winnered = (version: unknown) => version === WINNER_VERSION || rivered(version);
const exploited = (version: unknown) => version === EXPLOIT_VERSION || winnered(version);
const windowed = (version: unknown) => version === WINDOW_VERSION || exploited(version);
const FIELDS = [
  'hands',
  'vpip',
  'pfr',
  'threeBet',
  'aggr',
  'passive',
  'folds',
  'facedAggr',
  'cbetOpps',
  'cbetFolds',
  'f3bOpps',
  'f3bFolds',
  'bigBetSD',
  'bigBetSDStrong',
  'riverBetOpps',
  'riverBetFolds',
  'rHands',
  'rFolds',
  'rFacedAggr',
  'rAggr',
  'rPassive',
  'checks',
  'postAggr',
  'postPassive',
  'rChecks',
  'snapBetSD',
  'snapBetSDStrong',
  'tankBetSD',
  'tankBetSDStrong',
] as const satisfies readonly (keyof OpponentStats)[];
/** Not in FIELDS: the positional stat rows keep their v1-v5 length. */
const RIVER_CALL_FIELDS = [
  'riverCallSD',
  'riverCallSDWeak',
] as const satisfies readonly (keyof OpponentStats)[];
// A new consumed statistic must be considered explicitly in this codec.
const RIVER_POSITION_FIELDS = [
  'riverLastToActOpps',
  'riverLastToActBets',
] as const satisfies readonly (keyof OpponentStats)[];
const RIVER_RAISE_FIELDS = [
  'riverTripleCheckRaiseOpps',
  'riverTripleCheckRaiseFolds',
] as const satisfies readonly (keyof OpponentStats)[];
/** Not in FIELDS or the river-call sidecar: decayed (non-integer), present
 * only on a pooled row that saw a river opportunity, carried per row. */
const FAST_CALLDOWN_FIELDS = [
  'rvOpps',
  'rvCalls',
] as const satisfies readonly (keyof OpponentStats)[];
/** Not in FIELDS: pooled rows only, carried per row like the recency window. */
const PROBE_FIELDS = ['ctBets', 'ctProbes'] as const satisfies readonly (keyof OpponentStats)[];
/** Not in FIELDS: pooled rows only, carried per row like the probe tallies. */
const LIMP_RERAISE_FIELDS = [
  'lrOpps',
  'lrRaises',
] as const satisfies readonly (keyof OpponentStats)[];
const FLOP_STAB_FIELDS = [
  'flopCheckedToOpps',
  'flopBetCheckedTo',
  'fFlopCheckedToOpps',
  'fFlopBetCheckedTo',
] as const satisfies readonly (keyof FlopStabCounters)[];
const riverFields = (version: unknown) =>
  raised(version)
    ? [...RIVER_CALL_FIELDS, ...RIVER_POSITION_FIELDS, ...RIVER_RAISE_FIELDS]
    : positioned(version)
      ? [...RIVER_CALL_FIELDS, ...RIVER_POSITION_FIELDS]
      : RIVER_CALL_FIELDS;
const completeFields: Exclude<
  keyof OpponentStats,
  | (typeof FIELDS)[number]
  | (typeof RIVER_CALL_FIELDS)[number]
  | (typeof RIVER_POSITION_FIELDS)[number]
  | (typeof RIVER_RAISE_FIELDS)[number]
  | (typeof FAST_CALLDOWN_FIELDS)[number]
  | (typeof PROBE_FIELDS)[number]
  | (typeof LIMP_RERAISE_FIELDS)[number]
  | 'riverHu'
  | 'sourceWindow'
> extends never
  ? true
  : false = true;
void completeFields;
/** One pooledProvenance row on the wire: [keying (1 = cash table speed, 0 = cash with no domain on file), then m of
 * each PRE_REPAIR_STATS statistic in that order]. */
const PRE_REPAIR_ROW_LENGTH = 1 + PRE_REPAIR_STATS.length;
const PAIR_FIELDS = ['n3', 'opp3', 'nR', 'oppR'] as const;
type Rows<T> = Array<[string, T]>;
type Body = {
  version:
    | typeof VERSION
    | typeof ALLOCATED_VERSION
    | typeof WINDOW_VERSION
    | typeof EXPLOIT_VERSION
    | typeof WINNER_VERSION
    | typeof RIVER_CALL_VERSION
    | typeof RIVER_POSITION_VERSION
    | typeof RIVER_RAISE_VERSION
    | typeof MULTIWAY_RIVER_VERSION
    | typeof FAST_CALLDOWN_VERSION
    | typeof PROBE_VERSION
    | typeof LIMP_RERAISE_VERSION
    | typeof FLOP_STAB_VERSION
    | typeof PRE_REPAIR_VERSION
    | typeof LONG_PARTICIPATION_VERSION
    | typeof SHOWN_RIVER_VERSION
    | typeof PROFILE_COMPLETENESS_VERSION
    | typeof STREET_READ_VERSION
    | typeof RERAISE_RESPONSE_VERSION
    | typeof FLOP_SHOWN_VERSION
    | typeof POSTFLOP_BETS_VERSION;
  postflopBets?: Rows<number[]>;
  flopShown?: Rows<number[]>;
  streetPrice?: Rows<number[]>;
  reraiseResponse?: Rows<number[]>;
  streetRead?: Rows<number[]>;
  incompleteProfiles?: Rows<number[]>;
  pooledProvenance?: Rows<number[]>;
  exploitLong?: Rows<number[]>;
  shownRiver?: Rows<number[]>;
  scopedFlopStab?: Rows<number[]>;
  limpReraiseTallies?: Rows<number[]>;
  probeTallies?: Rows<number[]>;
  riverRecency?: Rows<number[]>;
  scopedRiverRecency?: Rows<number[]>;
  riverHu?: Rows<MultiwayRiverReadState>;
  scopedRiverHu?: Rows<MultiwayRiverReadState>;
  winnerReads?: Rows<HorseWinnerReadRow>;
  riverCalls?: Rows<number[]>;
  scopedRiverCalls?: Rows<number[]>;
  statsWindows?: Rows<HorseObservationWindow>;
  scopedWindows?: Rows<HorseObservationWindow>;
  exploit?: Rows<number[]>;
  planContext?: HorsePlanContext;
  actors: string[];
  handKey: string | null;
  stats: Rows<number[]>;
  scoped: Rows<number[]>;
  pairs: Rows<number[]>;
  plans: Rows<boolean>;
  raisePlans: Rows<RaiseResponsePlan>;
  outlooks: Rows<{ good: string[]; scare: string[] }>;
};
const fail = (): never => {
  throw new Error('Horse decision read frame is invalid');
};
const hash = (json: string) => createHash('sha256').update(json).digest('hex');
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const numbers = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(finite);
const cards = (v: unknown) =>
  Array.isArray(v) &&
  v.length <= 52 &&
  new Set(v).size === v.length &&
  v.every((c) => typeof c === 'string' && /^[2-9TJQKA][cdhs]$/.test(c));

function boundary(players: readonly Pick<SeatPlayer, 'user_id'>[], handKey: string | null) {
  if (!Array.isArray(players) || players.length < 1 || players.length > 10) return fail();
  const actors = players.map((p) => p?.user_id);
  if (
    new Set(actors).size !== actors.length ||
    actors.some((id) => typeof id !== 'string' || !id.length || id.length > 256) ||
    (handKey !== null && (typeof handKey !== 'string' || handKey.length > 512))
  )
    return fail();
  const exploit = new Set<string>(),
    scoped = new Set<string>(),
    pairs = new Set<string>(),
    plans = new Set<string>(),
    streets = new Set<string>();
  for (const id of actors) {
    for (const family of ['holdem', 'omaha', 'sixplus'])
      for (const size of ['hu', 'short', 'full']) scoped.add(`${family}:${size}|${id}`);
    for (const key of scoped) exploit.add(key);
    for (const variant of MEMORY_VARIANTS)
      for (const mode of ['cash', 'tournament'] as const)
        for (const size of ['hu', 'short', 'full'] as const)
          exploit.add(opponentMemoryKey(id, variant, mode, size));
    for (const other of actors) pairs.add(`${id}|${other}`);
    if (handKey !== null) {
      const key = `${handKey}|${id}`;
      plans.add(key);
      for (const street of ['preflop', 'flop', 'turn', 'river']) streets.add(`${key}|${street}`);
    }
  }
  return { actors, stats: new Set(actors), scoped, exploit, pairs, plans, streets };
}

function validRows(
  value: unknown,
  allowed: ReadonlySet<string>,
  valid: (v: unknown) => boolean
): boolean {
  if (!Array.isArray(value) || value.length > allowed.size) return false;
  const seen = new Set<string>();
  for (const row of value) {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== 'string' ||
      !allowed.has(row[0]) ||
      seen.has(row[0]) ||
      !valid(row[1])
    )
      return false;
    seen.add(row[0]);
  }
  return true;
}
function validateBody(
  value: unknown,
  b: ReturnType<typeof boundary>,
  handKey: string | null,
  planContext?: HorsePlanContext
): asserts value is Body {
  if (
    planContext !== undefined &&
    (!horsePlanContextIsValid(planContext) ||
      (handKey !== null && handKey !== horsePlanContextKey(planContext)))
  )
    return fail();
  if (
    !object(value) ||
    !exact(value, [
      'version',
      ...(windowed(value.version) ? ['statsWindows', 'scopedWindows'] : []),
      ...(exploited(value.version) ? ['exploit'] : []),
      ...(winnered(value.version) ? ['winnerReads'] : []),
      ...(rivered(value.version) ? ['riverCalls', 'scopedRiverCalls'] : []),
      ...(multiwayed(value.version) ? ['riverHu', 'scopedRiverHu'] : []),
      ...(recencied(value.version) ? ['riverRecency', 'scopedRiverRecency'] : []),
      ...(probed(value.version) ? ['probeTallies'] : []),
      ...(limpReraised(value.version) ? ['limpReraiseTallies'] : []),
      ...(preRepaired(value.version) ? ['pooledProvenance'] : []),
      ...(longParticipated(value.version) ? ['exploitLong'] : []),
      ...(shownRivered(value.version) ? ['shownRiver'] : []),
      ...(profileCompleted(value.version) ? ['incompleteProfiles'] : []),
      ...(streetReadListed(value.version) ? ['streetRead'] : []),
      ...(reraiseResponseListed(value.version) ? ['reraiseResponse'] : []),
      ...(flopShownListed(value.version) ? ['flopShown', 'streetPrice'] : []),
      ...(postflopBetsCarried(value.version) ? ['postflopBets'] : []),
      ...(flopStabbed(value.version) ? ['scopedFlopStab'] : []),
      ...(planContext === undefined ? [] : ['planContext']),
      'actors',
      'handKey',
      'stats',
      'scoped',
      'pairs',
      'plans',
      'raisePlans',
      'outlooks',
    ]) ||
    (!windowed(value.version) &&
      value.version !== (planContext === undefined ? VERSION : ALLOCATED_VERSION)) ||
    (planContext !== undefined &&
      (!horsePlanContextIsValid(value.planContext) ||
        horsePlanContextKey(value.planContext) !== horsePlanContextKey(planContext))) ||
    value.handKey !== handKey ||
    !Array.isArray(value.actors) ||
    value.actors.length !== b.actors.length ||
    value.actors.some((id, i) => id !== b.actors[i]) ||
    !validRows(value.stats, b.stats, (v) => numbers(v, FIELDS.length)) ||
    !validRows(value.scoped, b.scoped, (v) => numbers(v, FIELDS.length)) ||
    !validRows(value.pairs, b.pairs, (v) => numbers(v, PAIR_FIELDS.length)) ||
    !validRows(value.plans, b.plans, (v) => typeof v === 'boolean') ||
    !validRows(
      value.raisePlans,
      b.streets,
      (v) => v === 'commit' || v === 'callOnce' || v === 'foldToRaise'
    ) ||
    !validRows(
      value.outlooks,
      b.streets,
      (v) => object(v) && exact(v, ['good', 'scare']) && cards(v.good) && cards(v.scare)
    ) ||
    (exploited(value.version) &&
      !validRows(value.exploit, b.exploit, (v) => numbers(v, EXPLOIT_COUNTER_FIELDS.length))) ||
    (winnered(value.version) &&
      !validRows(
        value.winnerReads,
        b.stats,
        (v) =>
          object(v) &&
          exact(v, ['w', 'w2', 's', 'q']) &&
          finite(v.w) &&
          finite(v.w2) &&
          finite(v.q) &&
          typeof v.s === 'number' &&
          Number.isFinite(v.s)
      ))
  )
    return fail();
  if (windowed(value.version)) {
    const windows = (rows: unknown, statRows: Rows<number[]>, allowed: ReadonlySet<string>) =>
      validRows(rows, allowed, validWindow) &&
      (rows as Rows<HorseObservationWindow>).length === statRows.length &&
      (rows as Rows<HorseObservationWindow>).every(([id], i) => id === statRows[i][0]);
    if (
      !windows(value.statsWindows, value.stats as Rows<number[]>, b.stats) ||
      !windows(value.scopedWindows, value.scoped as Rows<number[]>, b.scoped)
    )
      return fail();
  }
  if (
    multiwayed(value.version) &&
    (!validRows(value.riverHu, b.stats, validMultiwayRiverState) ||
      !validRows(value.scopedRiverHu, b.scoped, validMultiwayRiverState))
  )
    return fail();
  if (recencied(value.version)) {
    // [rvOpps, rvCalls]: decayed, non-negative, calls never above opportunities.
    const recency = (v: unknown) =>
      numbers(v, FAST_CALLDOWN_FIELDS.length) && (v as number[])[1] <= (v as number[])[0];
    if (
      !validRows(value.riverRecency, b.stats, recency) ||
      !validRows(value.scopedRiverRecency, b.scoped, recency) ||
      // A v10 body carries at least one window, or it would have been v9.
      (value.version === FAST_CALLDOWN_VERSION &&
        (value.riverRecency as Rows<number[]>).length +
          (value.scopedRiverRecency as Rows<number[]>).length ===
          0)
    )
      return fail();
  }
  // [ctBets, ctProbes] / [lrOpps, lrRaises]: whole counts, the second never
  // above the first, pooled rows only.
  const tally = (v: unknown) =>
    numbers(v, 2) &&
    (v as number[]).every(Number.isInteger) &&
    (v as number[])[1] <= (v as number[])[0];
  if (probed(value.version)) {
    // A v11 body carries at least one probe row (or it would have been v10).
    if (
      !validRows(value.probeTallies, b.stats, tally) ||
      (value.version === PROBE_VERSION && (value.probeTallies as Rows<number[]>).length === 0)
    )
      return fail();
  }
  if (limpReraised(value.version)) {
    // A v12 body carries at least one limp-reraise row; a v13 body may carry an empty list when flopStab evidence is present.
    if (
      !validRows(value.limpReraiseTallies, b.stats, tally) ||
      (value.version === LIMP_RERAISE_VERSION &&
        (value.limpReraiseTallies as Rows<number[]>).length === 0)
    )
      return fail();
  }
  if (flopStabbed(value.version)) {
    const flopStabValid = (v: unknown) => {
      if (
        !numbers(v, FLOP_STAB_FIELDS.length) ||
        !((v as number[])[1] <= (v as number[])[0]) ||
        !((v as number[])[3] <= (v as number[])[2])
      )
        return false;
      return true;
    };
    if (
      !Array.isArray(value.scopedFlopStab) ||
      // A v13 body carries at least one flop-stab row (or it would have been v12); a v14 body may carry none.
      (value.version === FLOP_STAB_VERSION && value.scopedFlopStab.length === 0) ||
      value.scopedFlopStab.length > b.scoped.size ||
      !validRows(value.scopedFlopStab, b.scoped, flopStabValid)
    )
      return fail();
  }
  if (preRepaired(value.version)) {
    // [keying, m...]: keying 1 or 0, each m a non-negative finite count. Every row names a counter row this same
    // frame carries, and a v14 body carries at least one (or it would have been v13 or older).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    const provenanceValid = (v: unknown) =>
      numbers(v, PRE_REPAIR_ROW_LENGTH) && ((v as number[])[0] === 0 || (v as number[])[0] === 1);
    if (
      !Array.isArray(value.pooledProvenance) ||
      // A v15 body may carry an empty provenance list (it exists for its long rows).
      (value.version === PRE_REPAIR_VERSION && value.pooledProvenance.length === 0) ||
      !validRows(value.pooledProvenance, b.exploit, provenanceValid) ||
      (value.pooledProvenance as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (longParticipated(value.version)) {
    // [lHands, lVpip, lPfr]: decayed, non-negative, VPIP and PFR never above hands. Every row names an exploit row
    // this same frame carries, and a v15 body carries at least one (or it would have been v14 or older).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    const longValid = (v: unknown) =>
      numbers(v, EXPLOIT_LONG_FIELDS.length) &&
      (v as number[])[1] <= (v as number[])[0] + 1e-9 &&
      (v as number[])[2] <= (v as number[])[0] + 1e-9;
    if (
      !Array.isArray(value.exploitLong) ||
      // A v16 body may carry an empty long list (it exists for its shown river rows).
      (value.version === LONG_PARTICIPATION_VERSION && value.exploitLong.length === 0) ||
      !validRows(value.exploitLong, b.exploit, longValid) ||
      (value.exploitLong as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (shownRivered(value.version)) {
    // [older, bets, shown, strong per bucket]: every row names an exploit row this same frame carries, and a v16 body
    // carries at least one (or it would have been v15 or older).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    const shownValid = (v: unknown) =>
      numbers(v, SHOWN_RIVER_ROW_LENGTH) && shownRiverReadFromRow(v as number[]) !== null;
    if (
      !Array.isArray(value.shownRiver) ||
      // A v17 body may carry an empty shown river list (it exists for its incomplete-profile rows).
      (value.version === SHOWN_RIVER_VERSION && value.shownRiver.length === 0) ||
      !validRows(value.shownRiver, b.exploit, shownValid) ||
      (value.shownRiver as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (profileCompleted(value.version)) {
    // [1]: every row names an exploit row this same frame carries, and a v17 body carries at least one (a v18 body
    // may carry none: it exists for its street rows).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    if (
      !Array.isArray(value.incompleteProfiles) ||
      (value.version === PROFILE_COMPLETENESS_VERSION && value.incompleteProfiles.length === 0) ||
      !validRows(
        value.incompleteProfiles,
        b.exploit,
        (v) => numbers(v, 1) && (v as number[])[0] === 1
      ) ||
      (value.incompleteProfiles as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (postflopBetsCarried(value.version)) {
    // 30 numbers per row: every row is a valid record, names an exploit row this same frame carries, and a v22 body
    // carries at least one (or it would have been v20 or older).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    const betsValid = (v: unknown) =>
      numbers(v, POSTFLOP_BETS_ROW_LENGTH) && postflopBetsFromRow(v as number[]) !== null;
    if (
      !Array.isArray(value.postflopBets) ||
      value.postflopBets.length === 0 ||
      !validRows(value.postflopBets, b.exploit, betsValid) ||
      (value.postflopBets as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (flopShownListed(value.version)) {
    // flopShown, 80 integers: every row is a valid flop-shown record. streetPrice, [sum, opp] per street: every row
    // is a valid price record. Every row names an exploit row this same frame carries, and a v20 body carries at
    // least one row in one of the two lists (or it would have been v19 or older).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    // (a return can be negative, so the row is held to the record's own validation, not to `numbers`)
    const shownValid = (v: unknown) =>
      Array.isArray(v) && v.length === FLOP_SHOWN_ROW_LENGTH && flopShownFromRow(v) !== null;
    const priceValid = (v: unknown) =>
      numbers(v, STREET_PRICE_ROW_LENGTH) && streetPriceFromRow(v as number[]) !== null;
    if (
      !Array.isArray(value.flopShown) ||
      !Array.isArray(value.streetPrice) ||
      (flopShownCarried(value.version) &&
        value.flopShown.length + value.streetPrice.length === 0) ||
      !validRows(value.flopShown, b.exploit, shownValid) ||
      !validRows(value.streetPrice, b.exploit, priceValid) ||
      (value.flopShown as Rows<number[]>).some(([id]) => !carried.has(id)) ||
      (value.streetPrice as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (reraiseResponseListed(value.version)) {
    // [opp, fold, call, raise] per node: every row is a valid record, names an exploit row this same frame carries,
    // and a v19 body carries at least one (or it would have been v18 or older; a v20 body may carry none: it exists
    // for its flop-shown rows).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    const responseValid = (v: unknown) =>
      numbers(v, RERAISE_RESPONSE_ROW_LENGTH) && reraiseResponseFromRow(v as number[]) !== null;
    if (
      !Array.isArray(value.reraiseResponse) ||
      (reraiseResponseCarried(value.version) && value.reraiseResponse.length === 0) ||
      !validRows(value.reraiseResponse, b.exploit, responseValid) ||
      (value.reraiseResponse as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (streetReadListed(value.version)) {
    // [hit, opp] per cell: every row is a valid street read (hit never above opp), names an exploit row this same
    // frame carries, and a v18 body carries at least one (or it would have been v17 or older; a v19 body may carry
    // none: it exists for its response rows).
    const carried = new Set((value.exploit as Rows<number[]>).map(([id]) => id));
    const streetValid = (v: unknown) =>
      numbers(v, STREET_READ_ROW_LENGTH) && streetReadFromRow(v as number[]) !== null;
    if (
      !Array.isArray(value.streetRead) ||
      (streetReadCarried(value.version) && value.streetRead.length === 0) ||
      !validRows(value.streetRead, b.exploit, streetValid) ||
      (value.streetRead as Rows<number[]>).some(([id]) => !carried.has(id))
    )
      return fail();
  }
  if (rivered(value.version)) {
    const aligned = (rows: unknown, statRows: Rows<number[]>, allowed: ReadonlySet<string>) =>
      validRows(rows, allowed, (v) => numbers(v, riverFields(value.version).length)) &&
      (rows as Rows<number[]>).length === statRows.length &&
      (rows as Rows<number[]>).every(
        ([id, v], i) =>
          id === statRows[i][0] &&
          (!positioned(value.version) ||
            (Number.isSafeInteger(v[2]) && Number.isSafeInteger(v[3]) && v[3] <= v[2])) &&
          (!raised(value.version) ||
            (Number.isSafeInteger(v[4]) && Number.isSafeInteger(v[5]) && v[5] <= v[4]))
      );
    if (
      !aligned(value.riverCalls, value.stats as Rows<number[]>, b.stats) ||
      !aligned(value.scopedRiverCalls, value.scoped as Rows<number[]>, b.scoped)
    )
      return fail();
  }
}

function validWindow(value: unknown): boolean {
  if (!object(value) || !exact(value, ['version', 'coverage', 'fromMs', 'toMs'])) return false;
  const normalized = normalizeHorseObservationWindow(value);
  return Object.keys(normalized).every(
    (key) => value[key] === normalized[key as keyof HorseObservationWindow]
  );
}

export function encodeHorseDecisionReads(
  view: HorseMindSandbox,
  players: readonly Pick<SeatPlayer, 'user_id'>[],
  handKey: string | null,
  planContext?: HorsePlanContext
): HorseDecisionReadFrame {
  const b = boundary(players, handKey);
  // Refuse truncation and pending observations/writes rather than serializing
  // a partial runtime checkpoint as though it were a replayable read view.
  for (const key of ['seenActions', 'handFlags', 'dirty', 'dirtyPairs', 'dirtyScoped'] as const) {
    if (!(view[key] instanceof Set) || view[key].size !== 0) return fail();
  }
  const bounded = <T>(map: Map<string, T>, max: number): Rows<T> => {
    if (!(map instanceof Map) || map.size > max) return fail();
    return [...map];
  };
  const stats = (map: Map<string, OpponentStats>, max: number) =>
    bounded(map, max).map(([id, row]): [string, number[]] => {
      if (
        !object(row) ||
        !exact(row, [
          ...FIELDS,
          // A row carries both river-call counters or neither (a view built
          // before they existed); never one alone.
          ...(Object.hasOwn(row, RIVER_CALL_FIELDS[0]) ? RIVER_CALL_FIELDS : []),
          ...(Object.hasOwn(row, RIVER_POSITION_FIELDS[0]) ? RIVER_POSITION_FIELDS : []),
          ...(Object.hasOwn(row, RIVER_RAISE_FIELDS[0]) ? RIVER_RAISE_FIELDS : []),
          // The fast call-down window travels as a pair or not at all.
          ...(Object.hasOwn(row, FAST_CALLDOWN_FIELDS[0]) ? FAST_CALLDOWN_FIELDS : []),
          // The probe tallies travel as a pair or not at all.
          ...(Object.hasOwn(row, PROBE_FIELDS[0]) ? PROBE_FIELDS : []),
          // So do the limp-reraise tallies.
          ...(Object.hasOwn(row, LIMP_RERAISE_FIELDS[0]) ? LIMP_RERAISE_FIELDS : []),
          ...(Object.hasOwn(row, 'sourceWindow') ? ['sourceWindow'] : []),
          ...(Object.hasOwn(row, 'riverHu') ? ['riverHu'] : []),
        ])
      )
        return fail();
      return [id, FIELDS.map((f) => row[f])];
    });
  const riverCallRows = (map: Map<string, OpponentStats>): Rows<number[]> =>
    [...map].map(([id, row]) => [
      id,
      (hasRiverRaise
        ? [...RIVER_CALL_FIELDS, ...RIVER_POSITION_FIELDS, ...RIVER_RAISE_FIELDS]
        : hasRiverPosition
          ? [...RIVER_CALL_FIELDS, ...RIVER_POSITION_FIELDS]
          : RIVER_CALL_FIELDS
      ).map((f) => row[f] ?? 0),
    ]);
  // Do not alter predecessor bytes for metadata-absent historical views.
  const boundedStats = bounded(view.stats, b.stats.size);
  const boundedScoped = bounded(view.scoped, b.scoped.size);
  const exploitRows: Rows<number[]> = bounded(view.exploit ?? new Map(), b.exploit.size).map(
    ([id, row]: [string, ExploitCounters]): [string, number[]] => {
      // The long participation window travels as a triple or not at all (exploitLong, v15).
      if (
        !object(row) ||
        !exact(row, [
          ...EXPLOIT_COUNTER_FIELDS,
          ...(hasLongParticipation(row) ? EXPLOIT_LONG_FIELDS : []),
        ])
      )
        return fail();
      return [id, EXPLOIT_COUNTER_FIELDS.map((f) => row[f])];
    }
  );
  const longRows: Rows<number[]> = [...(view.exploit ?? new Map<string, ExploitCounters>())]
    .filter(([, row]) => hasLongParticipation(row))
    .map(([id, row]): [string, number[]] => [
      id,
      EXPLOIT_LONG_FIELDS.map((f) => (row as ExploitCountersWithLong)[f]!),
    ]);
  const shownRiverRows: Rows<number[]> = bounded(
    view.pooledShownRiver ?? new Map<string, ShownRiverRead>(),
    b.exploit.size
  ).map(([id, row]: [string, ShownRiverRead]): [string, number[]] => {
    if (!validShownRiverRead(row)) return fail();
    return [id, shownRiverRow(row)];
  });
  const incompleteRows: Rows<number[]> = bounded(
    view.pooledProfileIncomplete ?? new Map<string, true>(),
    b.exploit.size
  ).map(([id, flag]: [string, true]): [string, number[]] => {
    if (flag !== true) return fail();
    return [id, [1]];
  });
  const streetRows: Rows<number[]> = bounded(
    view.pooledStreetRead ?? new Map<string, StreetReadCounters>(),
    b.exploit.size
  ).map(([id, row]: [string, StreetReadCounters]): [string, number[]] => {
    if (!validStreetRead(row)) return fail();
    return [id, streetReadRow(row)];
  });
  const reraiseRows: Rows<number[]> = bounded(
    view.pooledReraiseResponse ?? new Map<string, ReraiseResponseCounters>(),
    b.exploit.size
  ).map(([id, row]: [string, ReraiseResponseCounters]): [string, number[]] => {
    if (!validReraiseResponse(row)) return fail();
    return [id, reraiseResponseRow(row)];
  });
  const flopShownRows: Rows<number[]> = bounded(
    view.pooledFlopShown ?? new Map<string, FlopShownCounters>(),
    b.exploit.size
  ).map(([id, row]: [string, FlopShownCounters]): [string, number[]] => {
    if (!validFlopShown(row)) return fail();
    return [id, flopShownRow(row)];
  });
  const streetPriceRows: Rows<number[]> = bounded(
    view.pooledStreetPrice ?? new Map<string, StreetPriceCounters>(),
    b.exploit.size
  ).map(([id, row]: [string, StreetPriceCounters]): [string, number[]] => {
    if (!validStreetPrice(row)) return fail();
    return [id, streetPriceRow(row)];
  });
  const betsRows: Rows<number[]> = bounded(
    view.pooledPostflopBets ?? new Map<string, PostflopBetCounters>(),
    b.exploit.size
  ).map(([id, row]: [string, PostflopBetCounters]): [string, number[]] => {
    if (!validPostflopBets(row)) return fail();
    return [id, postflopBetsRow(row)];
  });
  const hasPostflopBets = betsRows.length > 0;
  const hasFlopShown = flopShownRows.length > 0 || streetPriceRows.length > 0 || hasPostflopBets;
  const hasReraiseResponse = reraiseRows.length > 0 || hasFlopShown;
  const hasStreetRead = streetRows.length > 0 || hasReraiseResponse;
  const hasIncomplete = incompleteRows.length > 0 || hasStreetRead;
  const hasShownRiver = shownRiverRows.length > 0 || hasIncomplete;
  const hasLong = longRows.length > 0 || hasShownRiver;
  const flopStabRows: Rows<number[]> = bounded(view.flopStab ?? new Map(), b.scoped.size).map(
    ([id, row]: [string, FlopStabCounters]): [string, number[]] => {
      if (!object(row) || !exact(row, FLOP_STAB_FIELDS)) return fail();
      return [id, FLOP_STAB_FIELDS.map((f) => row[f])];
    }
  );
  const provenanceRows: Rows<number[]> = bounded(
    view.pooledProvenance ?? new Map(),
    b.exploit.size
  ).map(([id, row]: [string, PooledRowProvenance]): [string, number[]] => {
    if (
      !object(row) ||
      !exact(row, ['preRepair', 'postRelease']) ||
      (row.preRepair !== true && row.preRepair !== null) ||
      !object(row.postRelease) ||
      !exact(row.postRelease, PRE_REPAIR_STATS)
    )
      return fail();
    return [
      id,
      [row.preRepair === true ? 1 : 0, ...PRE_REPAIR_STATS.map((f) => row.postRelease[f])],
    ];
  });
  const hasPreRepair = provenanceRows.length > 0 || hasLong;
  const hasFlopStab = flopStabRows.length > 0 || hasPreRepair;
  const hasExploit = exploitRows.length > 0;
  const hasWinner = view.winnerReads !== undefined;
  if (hasWinner && (!(view.winnerReads!.seen instanceof Set) || view.winnerReads!.seen.size !== 0))
    return fail();
  const hasLimpReraise =
    hasFlopStab || boundedStats.some(([, row]) => object(row) && row.lrOpps !== undefined);
  const hasProbes =
    hasLimpReraise || boundedStats.some(([, row]) => object(row) && row.ctBets !== undefined);
  // Scoped rows never carry the tallies (applyScopedDelta mirrors only the
  // scoped fields); one that does is not a view this codec can carry.
  if (
    boundedScoped.some(
      ([, row]) => object(row) && (row.ctBets !== undefined || row.lrOpps !== undefined)
    )
  )
    return fail();
  const hasFastCalldown =
    hasProbes ||
    [boundedStats, boundedScoped].some((rows) =>
      rows.some(([, row]) => object(row) && row.rvOpps !== undefined)
    );
  const hasMultiwayRiver = [boundedStats, boundedScoped].some((rows) =>
    rows.some(([, row]) => row.riverHu !== undefined)
  );
  const hasRiverRaise =
    hasFastCalldown ||
    hasMultiwayRiver ||
    [boundedStats, boundedScoped].some((rows) =>
      rows.some(
        ([, row]) => object(row) && RIVER_RAISE_FIELDS.some((f) => finite(row[f]) && row[f] > 0)
      )
    );
  const hasRiverPosition =
    hasRiverRaise ||
    [boundedStats, boundedScoped].some((rows) =>
      rows.some(
        ([, row]) => object(row) && RIVER_POSITION_FIELDS.some((f) => finite(row[f]) && row[f] > 0)
      )
    );
  const hasRiverCalls =
    hasRiverPosition ||
    [boundedStats, boundedScoped].some((rows) =>
      rows.some(
        ([, row]) => object(row) && RIVER_CALL_FIELDS.some((f) => finite(row[f]) && row[f] > 0)
      )
    );
  const hasWindows =
    hasRiverCalls ||
    hasWinner ||
    hasExploit ||
    [boundedStats, boundedScoped].some((rows) =>
      rows.some(([, row]) => object(row) && Object.hasOwn(row, 'sourceWindow'))
    );
  const windows = (map: Map<string, OpponentStats>): Rows<HorseObservationWindow> =>
    [...map].map(([id, row]) => [id, normalizeHorseObservationWindow(row.sourceWindow)]);
  const huRows = (map: Map<string, OpponentStats>): Rows<MultiwayRiverReadState> =>
    [...map]
      .filter(([, row]) => row.riverHu !== undefined)
      .map(([id, row]) => [id, structuredClone(row.riverHu!)]);
  const recencyRows = (map: Map<string, OpponentStats>): Rows<number[]> =>
    [...map]
      .filter(([, row]) => row.rvOpps !== undefined)
      .map(([id, row]) => [id, FAST_CALLDOWN_FIELDS.map((f) => row[f] ?? 0)]);
  const probeRows = (map: Map<string, OpponentStats>): Rows<number[]> =>
    [...map]
      .filter(([, row]) => row.ctBets !== undefined)
      .map(([id, row]) => [id, PROBE_FIELDS.map((f) => row[f] ?? 0)]);
  const limpReraiseRows = (map: Map<string, OpponentStats>): Rows<number[]> =>
    [...map]
      .filter(([, row]) => row.lrOpps !== undefined)
      .map(([id, row]) => [id, LIMP_RERAISE_FIELDS.map((f) => row[f] ?? 0)]);
  const body: Body = {
    ...(hasPostflopBets ? { postflopBets: betsRows } : {}),
    ...(hasFlopShown ? { flopShown: flopShownRows, streetPrice: streetPriceRows } : {}),
    ...(hasReraiseResponse ? { reraiseResponse: reraiseRows } : {}),
    ...(hasStreetRead ? { streetRead: streetRows } : {}),
    ...(hasIncomplete ? { incompleteProfiles: incompleteRows } : {}),
    ...(hasPreRepair ? { pooledProvenance: provenanceRows } : {}),
    ...(hasLong ? { exploitLong: longRows } : {}),
    ...(hasShownRiver ? { shownRiver: shownRiverRows } : {}),
    ...(hasFlopStab ? { scopedFlopStab: flopStabRows } : {}),
    ...(hasLimpReraise ? { limpReraiseTallies: limpReraiseRows(view.stats) } : {}),
    ...(hasProbes ? { probeTallies: probeRows(view.stats) } : {}),
    ...(hasFastCalldown
      ? { riverRecency: recencyRows(view.stats), scopedRiverRecency: recencyRows(view.scoped) }
      : {}),
    ...(hasFastCalldown || hasMultiwayRiver
      ? { riverHu: huRows(view.stats), scopedRiverHu: huRows(view.scoped) }
      : {}),
    version: hasPostflopBets
      ? POSTFLOP_BETS_VERSION
      : hasFlopShown
        ? FLOP_SHOWN_VERSION
        : hasReraiseResponse
          ? RERAISE_RESPONSE_VERSION
          : hasStreetRead
            ? STREET_READ_VERSION
            : hasIncomplete
              ? PROFILE_COMPLETENESS_VERSION
              : hasShownRiver
                ? SHOWN_RIVER_VERSION
                : hasLong
                  ? LONG_PARTICIPATION_VERSION
                  : hasPreRepair
                    ? PRE_REPAIR_VERSION
                    : hasFlopStab
                      ? FLOP_STAB_VERSION
                      : hasLimpReraise
                        ? LIMP_RERAISE_VERSION
                        : hasProbes
                          ? PROBE_VERSION
                          : hasFastCalldown
                            ? FAST_CALLDOWN_VERSION
                            : hasMultiwayRiver
                              ? MULTIWAY_RIVER_VERSION
                              : hasRiverRaise
                                ? RIVER_RAISE_VERSION
                                : hasRiverPosition
                                  ? RIVER_POSITION_VERSION
                                  : hasRiverCalls
                                    ? RIVER_CALL_VERSION
                                    : hasWinner
                                      ? WINNER_VERSION
                                      : hasExploit
                                        ? EXPLOIT_VERSION
                                        : hasWindows
                                          ? WINDOW_VERSION
                                          : planContext === undefined
                                            ? VERSION
                                            : ALLOCATED_VERSION,
    ...(hasWindows
      ? { statsWindows: windows(view.stats), scopedWindows: windows(view.scoped) }
      : {}),
    ...(hasRiverCalls || hasWinner || hasExploit ? { exploit: exploitRows } : {}),
    ...(hasWinner
      ? { winnerReads: bounded(view.winnerReads!.rows, b.stats.size) }
      : hasRiverCalls
        ? { winnerReads: [] }
        : {}),
    ...(hasRiverCalls
      ? { riverCalls: riverCallRows(view.stats), scopedRiverCalls: riverCallRows(view.scoped) }
      : {}),
    ...(planContext === undefined ? {} : { planContext }),
    actors: b.actors,
    handKey,
    stats: stats(view.stats, b.stats.size),
    scoped: stats(view.scoped, b.scoped.size),
    pairs: bounded(view.pairs, b.pairs.size).map(([id, row]) => {
      if (!object(row) || !exact(row, PAIR_FIELDS)) return fail();
      return [id, PAIR_FIELDS.map((f) => row[f])];
    }),
    plans: bounded(view.plans, b.plans.size),
    raisePlans: bounded(view.raisePlans, b.streets.size),
    outlooks: bounded(view.outlooks, b.streets.size).map(([id, row]) => {
      if (
        !object(row) ||
        !exact(row, ['good', 'scare']) ||
        !(row.good instanceof Set) ||
        !(row.scare instanceof Set) ||
        row.good.size > 52 ||
        row.scare.size > 52
      )
        return fail();
      return [id, { good: [...row.good], scare: [...row.scare] }];
    }),
  };
  validateBody(body, b, handKey, planContext);
  const json = JSON.stringify(body),
    bytes = Buffer.byteLength(json);
  if (bytes > HORSE_DECISION_READ_FRAME_MAX_BYTES) return fail();
  return Object.freeze({ version: body.version, bytes, sha256: hash(json), json });
}

export function decodeHorseDecisionReads(
  frame: HorseDecisionReadFrame,
  players: readonly Pick<SeatPlayer, 'user_id'>[],
  handKey: string | null,
  planContext?: HorsePlanContext
): HorseMindSandbox {
  const b = boundary(players, handKey);
  if (
    !object(frame) ||
    !exact(frame, ['version', 'bytes', 'sha256', 'json']) ||
    (!windowed(frame.version) &&
      frame.version !== (planContext === undefined ? VERSION : ALLOCATED_VERSION)) ||
    typeof frame.json !== 'string' ||
    frame.json.length > HORSE_DECISION_READ_FRAME_MAX_BYTES ||
    !Number.isSafeInteger(frame.bytes) ||
    frame.bytes < 0 ||
    frame.bytes > HORSE_DECISION_READ_FRAME_MAX_BYTES ||
    Buffer.byteLength(frame.json) !== frame.bytes ||
    typeof frame.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(frame.sha256) ||
    hash(frame.json) !== frame.sha256
  )
    return fail();
  let body: unknown;
  try {
    body = JSON.parse(frame.json);
  } catch {
    return fail();
  }
  validateBody(body, b, handKey, planContext);
  if (body.version !== frame.version) return fail();
  const view = HorseMind.createSandbox();
  const stats = (
    rows: Rows<number[]>,
    windows?: Rows<HorseObservationWindow>,
    riverCalls?: Rows<number[]>
  ) =>
    new Map(
      rows.map(([id, values], i) => [
        id,
        {
          ...Object.fromEntries(FIELDS.map((f, i) => [f, values[i]])),
          // v1-v5 frames predate the river-call counters: no sample, read as 0.
          ...Object.fromEntries(RIVER_CALL_FIELDS.map((f, j) => [f, riverCalls?.[i][1][j] ?? 0])),
          ...Object.fromEntries(
            RIVER_POSITION_FIELDS.map((f, j) => [
              f,
              positioned(body.version)
                ? (riverCalls?.[i][1][j + RIVER_CALL_FIELDS.length] ?? 0)
                : 0,
            ])
          ),
          ...Object.fromEntries(
            RIVER_RAISE_FIELDS.map((f, j) => [
              f,
              raised(body.version) ? (riverCalls?.[i][1][j + 4] ?? 0) : 0,
            ])
          ),
          ...(windows ? { sourceWindow: normalizeHorseObservationWindow(windows[i][1]) } : {}),
        } as unknown as OpponentStats,
      ])
    );
  view.stats = stats(body.stats, body.statsWindows, body.riverCalls);
  view.scoped = stats(body.scoped, body.scopedWindows, body.scopedRiverCalls);
  if (probed(body.version)) {
    for (const [id, [ctBets, ctProbes]] of body.probeTallies!) {
      const stat = view.stats.get(id);
      if (!stat) return fail();
      stat.ctBets = ctBets;
      stat.ctProbes = ctProbes;
    }
  }
  if (limpReraised(body.version)) {
    for (const [id, [lrOpps, lrRaises]] of body.limpReraiseTallies!) {
      const stat = view.stats.get(id);
      if (!stat) return fail();
      stat.lrOpps = lrOpps;
      stat.lrRaises = lrRaises;
    }
  }
  if (preRepaired(body.version)) {
    view.pooledProvenance = new Map(
      body.pooledProvenance!.map(([id, v]) => [
        id,
        {
          preRepair: v[0] === 1 ? (true as const) : null,
          postRelease: Object.fromEntries(
            PRE_REPAIR_STATS.map((f, i) => [f, v[i + 1]])
          ) as PooledRowProvenance['postRelease'],
        },
      ])
    );
  }
  // A v14 body may carry an empty flop-stab list: it decodes like a frame without one.
  if (flopStabbed(body.version) && body.scopedFlopStab!.length > 0) {
    view.flopStab = new Map(
      body.scopedFlopStab!.map(([id, v]) => [
        id,
        Object.fromEntries(
          FLOP_STAB_FIELDS.map((f, i) => [f, v[i]])
        ) as unknown as FlopStabCounters,
      ])
    );
  }
  if (recencied(body.version)) {
    for (const [map, rows] of [
      [view.stats, body.riverRecency!],
      [view.scoped, body.scopedRiverRecency!],
    ] as const) {
      for (const [id, [rvOpps, rvCalls]] of rows) {
        const stat = map.get(id);
        if (!stat) return fail();
        stat.rvOpps = rvOpps;
        stat.rvCalls = rvCalls;
      }
    }
  }
  if (multiwayed(body.version)) {
    for (const [id, row] of body.riverHu!) {
      const stat = view.stats.get(id);
      if (!stat) return fail();
      stat.riverHu = structuredClone(row);
    }
    for (const [id, row] of body.scopedRiverHu!) {
      const stat = view.scoped.get(id);
      if (!stat) return fail();
      stat.riverHu = structuredClone(row);
    }
  }
  view.pairs = new Map(
    body.pairs.map(([id, v]) => [id, { n3: v[0], opp3: v[1], nR: v[2], oppR: v[3] }])
  );
  view.plans = new Map(body.plans);
  view.raisePlans = new Map(body.raisePlans);
  view.outlooks = new Map(
    body.outlooks.map(([id, v]) => [id, { good: new Set(v.good), scare: new Set(v.scare) }])
  );
  view.exploit = new Map(
    (body.exploit ?? []).map(([id, v]) => [
      id,
      Object.fromEntries(
        EXPLOIT_COUNTER_FIELDS.map((f, i) => [f, v[i]])
      ) as unknown as ExploitCounters,
    ])
  );
  if (longParticipated(body.version)) {
    for (const [id, v] of body.exploitLong!) {
      const row: ExploitCountersWithLong | undefined = view.exploit.get(id);
      if (!row) return fail();
      EXPLOIT_LONG_FIELDS.forEach((f, i) => (row[f] = v[i]));
    }
  }
  if (shownRivered(body.version) && body.shownRiver!.length > 0)
    view.pooledShownRiver = new Map(
      body.shownRiver!.map(([id, v]) => [id, shownRiverReadFromRow(v) ?? fail()])
    );
  // A v18 body may carry an empty incomplete-profile list: it decodes like a frame without one.
  if (profileCompleted(body.version) && body.incompleteProfiles!.length > 0)
    view.pooledProfileIncomplete = new Map(
      body.incompleteProfiles!.map(([id]): [string, true] => [id, true])
    );
  // A v19 body may carry an empty street list: it decodes like a frame without one.
  if (streetReadListed(body.version) && body.streetRead!.length > 0)
    view.pooledStreetRead = new Map(
      body.streetRead!.map(([id, v]) => [id, streetReadFromRow(v) ?? fail()])
    );
  // A v20 body may carry an empty response list: it decodes like a frame without one.
  if (reraiseResponseListed(body.version) && body.reraiseResponse!.length > 0)
    view.pooledReraiseResponse = new Map(
      body.reraiseResponse!.map(([id, v]) => [id, reraiseResponseFromRow(v) ?? fail()])
    );
  // A v20 body may carry either of its own lists empty: an empty one decodes like a frame without it.
  if (flopShownListed(body.version) && body.flopShown!.length > 0)
    view.pooledFlopShown = new Map(
      body.flopShown!.map(([id, v]) => [id, flopShownFromRow(v) ?? fail()])
    );
  if (flopShownListed(body.version) && body.streetPrice!.length > 0)
    view.pooledStreetPrice = new Map(
      body.streetPrice!.map(([id, v]) => [id, streetPriceFromRow(v) ?? fail()])
    );
  if (postflopBetsCarried(body.version))
    view.pooledPostflopBets = new Map(
      body.postflopBets!.map(([id, v]) => [id, postflopBetsFromRow(v) ?? fail()])
    );
  if (winnered(body.version))
    view.winnerReads = { rows: new Map(body.winnerReads), seen: new Set() };
  return view;
}
