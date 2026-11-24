/**
 * SHADOW STAGE FOR THE DARK PLO4/PLO5 CASH OPTIONS (2026-11-20, PLO-OWNER lane SHADOW).
 *
 * WHY. A PLO4/PLO5 cash option that ships dark cannot be graded offline: replays find too few decisions with a
 * person in the hand. The option shadow (HorseOptionShadow.ts, Horse Switch lane) already re-decides a committed
 * decision once with one option flipped and journals the counterfactual, never acting on it. For the options listed
 * here (and only for them) this file fits that shadow to PLO4/PLO5 cash:
 *  - SCOPE: a listed option is re-decided only in a PLO4 or PLO5 cash decision (table and Lightning; the scope the
 *    omaha option game scope reads, omahaOptionGameOf), in its listed games and streets. Never PLO6, PLO8, hold'em,
 *    a tournament or a bomb pot: there it is left out before the pick, so it spends no budget.
 *  - ACTED-TIME BUDGET: 50 ms instead of the shadow's 15 ms (most priced Omaha postflop decisions take over 15 ms).
 *  - SAMPLING: a hand with no person dealt in takes at most OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE re-decisions
 *    per worker per clock minute; the rest of the shadow's per-minute budget is left for hands with a person dealt
 *    in. This orders a measurement only: no decision reads it.
 *  - LATENCY BREAKER (automatic self-disable): per option and worker, one re-decision over 150 ms, or three over
 *    50 ms within the last 20, stops that option's re-decisions in this worker until the worker restarts. A
 *    re-decision is charged the time it actually ran (2026-11-23, see optionShadowStageChargedMs): its wall time, or
 *    the worker thread's own CPU time over the same span when that is lower, so a pause of the thread that the
 *    re-decision did not cause (descheduled, waiting) is not charged to the option.
 *  - COMPANIONS: an option that acts only with another option on (the math core's street flag needs omahaMathCore)
 *    is re-decided with the companion true as well when it is flipped to true.
 *
 * TIMING (2026-11-20, VERIFIER V52). Nothing of a staged re-decision runs before the answer is sent: up to the
 * FAST_RESULT the worker does exactly what it does with no row, and reads no seat of the table for the stage. After
 * the answer the pick is handed over; when its job has ended it is dropped at once if any request is waiting,
 * otherwise it is put on the worker's one lane behind an event-loop turn and starts only if the worker is still idle
 * and no job has started since its decision (the Horse memory is what the decision left). The stage's gates (acted
 * time, governor scale, breaker, Horse-only cap, the shared per-minute budget) are taken then. Its receipt cannot
 * ride in its own decision's journal record (already written). It adds NO journal record kind (an engine of an older
 * release rejects an unknown kind, and after a rollback would meet it in a segment): it is held in the worker (at
 * most 8, older ones dropped and counted option_shadow_stage_receipt_dropped_seen) and rides in the NEXT decision
 * record that worker journals, field `stagedOptionShadowReceipts`: [{ decisionKey, requestId, decisionTimeMs,
 * receipt }], each naming the decision it re-decided. A reader joins on decisionKey. Receipts held when a worker
 * stops are lost (a measurement sample, never a decision). What remains: a request that arrives WHILE a
 * re-decision is running waits for it to end (at most one re-decision; the breaker bounds how long and how often).
 *
 * WHAT IT NEVER DOES. It runs after the acted decision is final and changes nothing of it (the law
 * aListedOptionInShadowStageNeverChangesTheActedDecision.test.ts). It adds no row, no state and no setting: a listed
 * option is staged by the same `shadow` row as any option. With no listed option in shadow nothing here runs past a
 * name lookup. It reads no hole card, no opponent identity and no person/Horse fact for any decision.
 */
import { omahaOptionGameOf, type OmahaOptionGame } from './HorseOmahaOptionGameScope.js';

export interface OptionShadowStageEntry {
  /** The games (4 = PLO4 cash, 5 = PLO5 cash) the option is re-decided in. */
  readonly games: readonly OmahaOptionGame[];
  /** The streets it is re-decided on (gameState.stage); absent = every street. */
  readonly streets?: readonly string[];
  /** Options passed true with it when it is flipped to true. */
  readonly companions?: readonly string[];
}
export type OptionShadowStageTable = Readonly<Record<string, OptionShadowStageEntry>>;

const PLO4_PLO5: OptionShadowStageEntry = Object.freeze({ games: Object.freeze([4, 5] as const) });

/**
 * The staged options. A name the registry does not hold, or that does not take shadow there, is inert (the shadow
 * only ever picks a registered option in shadow or on_shadow). omahaOpponentLifetimeHud is NOT listed: in shadow
 * nothing arms its lifetime record, so a flipped re-decision would read "same" falsely. The math core's street flags
 * were taken out on 2026-11-20 (VERIFIER V59: a re-decision with the core cost 50-125 ms on PLO5 postflop, and a
 * request arriving on the same worker would wait behind it). omahaMathCorePlo5Flop returns on 2026-11-21 (lead-2
 * order, lane CORE-POOLED-3) because that cost is now lower: the core's 2+3 evaluator is table driven and it does no
 * work on a street whose flag is off, so a PLO5 flop decision with the core on costs p50 14.0 / p95 28.8 / max 39.9 ms
 * in all (added p50 11.5 / p95 26.5 ms; CRITERIA-CORE-POOLED-3-LATENCY-AMEND run, load 16), under the breaker's 50 ms
 * slow line. It is staged on PLO5 flop only, with omahaMathCore as its companion (the street flag acts only with it).
 * The other core street flags stay out. Like every listed name it re-decides only once its registry entry takes
 * shadow (a release-default classification, a separate switch-list change).
 */
export const OPTION_SHADOW_STAGE: OptionShadowStageTable = Object.freeze({
  // OPPONENT-HUD-9 2026-11-21: the lifetime-HUD consumer re-decides postflop (its only scope) while the store option is
  // on and has attached the packet; with the store off no packet exists and the re-decision reads "same" (no reads).
  omahaOpponentLifetimeHudDecides: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
    companions: Object.freeze(['omahaOpponentLifetimeHud']),
  }),
  // PLO-OWNER lead-4 B4 2026-11-21: priced six-max preflop read on lifetime HUD cells
  omahaPreflopReadIsPricedFromLifetime: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['preflop']),
    companions: Object.freeze(['omahaOpponentLifetimeHud']),
  }),
  omahaBetSizeIsPricedForTheRange: PLO4_PLO5,
  omahaRiverCheckedToBetIsMeasured: PLO4_PLO5,
  omahaRiverFirstToActBetIsPriced: PLO4_PLO5,
  omahaFlopBetIsPricedOnHisResponse: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaFourBetFoldPricedCall: PLO4_PLO5,
  // PLO-LEAD-6 2026-11-24: acts only preflop, facing one open out of position
  omahaOopReraiseRangeHoldsVsReraise: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['preflop']),
  }),
  omahaStabDefenceIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  omahaRiverBetFoldIsHisRecord: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaCbetRaiseIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaBigBetSizeIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
  }),
  omahaBigDrawBetIsPricedOnHisResponse: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn']),
  }),
  omahaMathCorePlo5Flop: Object.freeze({
    games: Object.freeze([5] as const),
    streets: Object.freeze(['flop']),
    companions: Object.freeze(['omahaMathCore']),
  }),
});

/** The acted decision may have taken this long and a listed option is still re-decided. */
export const OPTION_SHADOW_STAGE_ACTED_BUDGET_MS = 50;
/** A staged re-decision over this is a slow one. */
export const OPTION_SHADOW_STAGE_SLOW_MS = 50;
/** One staged re-decision over this disables the option in this worker at once. */
export const OPTION_SHADOW_STAGE_HARD_MS = 150;
/** This many slow ones within the last OPTION_SHADOW_STAGE_WINDOW disable it. */
export const OPTION_SHADOW_STAGE_SLOW_STRIKES = 3;
export const OPTION_SHADOW_STAGE_WINDOW = 20;
/** Staged re-decisions per worker per clock minute in hands with no person dealt in. */
export const OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE = 2;

/**
 * THE TIME A STAGED RE-DECISION IS CHARGED (2026-11-23, PLO-OWNER lead-5 PHASE4).
 *
 * WHY. The breaker read wall time only, so a pause of the worker thread during a re-decision was charged to the
 * option. Live, serving 735299cd5fda (2026-11-23 04:33-08:06Z, horse_brain_flush_receipts): omahaMathCorePlo5Flop
 * re-decided 727 times, avg 17.0 ms, and one re-decision of 195.8 ms (07:21:25-07:22:25Z, worker 78ffa527) tripped
 * the one-over-150 ms rule, while that worker's 16 PLO5 and 32 hold'em acted decisions of the same minute took at
 * most 41.4 ms. Five of the 727 took 100-200 ms (0.69%), against 80 of 137,292 acted decisions (0.058%) on the
 * engine's eight workers, and in those five minutes no acted decision of the same worker took over 78 ms. On the Mac
 * (origin/main 608f33c5, Node 22.23.3, 10,000 PLO5 flop core decisions over 624 states) the same path used at most
 * 27.5 ms of thread CPU once warm (p99.9 18.7 ms), and its one 146.1 ms wall reading used 27.5 ms of CPU. On
 * 2026-11-22 19:32Z (ea92b56f) omahaStabDefenceIsPriced, a 1.4-6.4 ms re-decision, tripped the same rule at 392.2 ms.
 *
 * WHAT. A re-decision is charged min(wall, thread CPU): the CPU the worker thread itself spent between the
 * re-decision's start and end (process.threadCpuUsage reads the calling thread only; process.cpuUsage would add every
 * other thread of the process). A re-decision that is slow because it computes is on the CPU for that time, so it is
 * charged its wall time less only the time its thread did not run, and a slow option trips at the same re-decision
 * as before. With no CPU reading (NaN, negative, absent, or a runtime without threadCpuUsage) the charge is the wall
 * time, exactly as before; a wall time that is not a number is charged as such and trips, as before. The charge is
 * never above the wall time, so the breaker trips nowhere it did not trip before. Charged: work on the worker thread
 * inside the re-decision, its own share of garbage collection included. Not charged: time the thread did not run
 * (descheduled, or blocked in a synchronous wait); the staged decide path does no synchronous I/O (the core reads
 * its tables when its modules load).
 */
export function optionShadowStageChargedMs(wallMs: number, threadCpuMs?: number | null): number {
  if (typeof threadCpuMs !== 'number' || !Number.isFinite(threadCpuMs) || threadCpuMs < 0)
    return wallMs;
  return threadCpuMs < wallMs ? threadCpuMs : wallMs;
}

/** True when the wall time alone would have been a slow (or hard) re-decision and the charged time is not. */
export function optionShadowStageWallOnlySlow(
  wallMs: number,
  threadCpuMs?: number | null
): boolean {
  return (
    wallMs > OPTION_SHADOW_STAGE_SLOW_MS &&
    !(optionShadowStageChargedMs(wallMs, threadCpuMs) > OPTION_SHADOW_STAGE_SLOW_MS)
  );
}

export function optionShadowStaged(
  option: string | null | undefined,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE
): boolean {
  return typeof option === 'string' && Object.hasOwn(table, option);
}

/**
 * The options in shadow this decision may re-decide: every option that is not listed, unchanged and in order, and a
 * listed option only when the decision is in its games and streets. With no listed option in `options` the same
 * array is returned and the decision is not read.
 */
export function optionShadowStageInScope(
  options: readonly string[],
  player: unknown,
  gameState: unknown,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE
): readonly string[] {
  if (!options.some((o) => Object.hasOwn(table, o))) return options;
  let game: OmahaOptionGame | null = null;
  let street = '';
  try {
    game = omahaOptionGameOf(
      player as Parameters<typeof omahaOptionGameOf>[0],
      gameState as Parameters<typeof omahaOptionGameOf>[1]
    );
    street = String((gameState as { stage?: unknown } | null)?.stage ?? '').toLowerCase();
  } catch {
    game = null;
  }
  return options.filter((o) => {
    if (!Object.hasOwn(table, o)) return true;
    const entry = table[o]!;
    if (game === null || !entry.games.includes(game)) return false;
    return !entry.streets || entry.streets.includes(street);
  });
}

/** The companions a staged re-decision passes true: only when the option is flipped to true, only those not on. */
export function optionShadowStageCompanions(
  option: string,
  flippedTo: boolean,
  acted: Readonly<Record<string, unknown>>,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE
): Readonly<Record<string, true>> {
  const out: Record<string, true> = {};
  if (!flippedTo || !Object.hasOwn(table, option)) return out;
  for (const c of table[option]!.companions ?? []) if (acted[c] !== true) out[c] = true;
  return out;
}

/** Per worker: the latency breaker of each staged option and the Horse-only per-minute cap. */
export class OptionShadowStageGuard {
  private readonly off = new Set<string>();
  private readonly recent = new Map<string, boolean[]>();
  private window = Number.NaN;
  private horseOnlyUsed = 0;

  /** True once the option's breaker has tripped in this worker; it stays true. */
  disabled(option: string): boolean {
    return this.off.has(option);
  }

  /**
   * Records one staged re-decision: its wall time and, when read, the worker thread's CPU time over the same span.
   * It is charged optionShadowStageChargedMs(ms, threadCpuMs). True exactly when this one trips the breaker.
   */
  note(option: string, ms: number, threadCpuMs?: number | null): boolean {
    if (this.off.has(option)) return false;
    ms = optionShadowStageChargedMs(ms, threadCpuMs);
    const slow = !(ms <= OPTION_SHADOW_STAGE_SLOW_MS);
    const ring = this.recent.get(option) ?? [];
    ring.push(slow);
    if (ring.length > OPTION_SHADOW_STAGE_WINDOW) ring.shift();
    this.recent.set(option, ring);
    const strikes = ring.reduce((n, s) => n + (s ? 1 : 0), 0);
    if (!(ms <= OPTION_SHADOW_STAGE_HARD_MS) || strikes >= OPTION_SHADOW_STAGE_SLOW_STRIKES) {
      this.off.add(option);
      this.recent.delete(option);
      return true;
    }
    return false;
  }

  /** A hand with no person dealt in: true at most OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE times a clock minute. */
  admitHorseOnly(nowMs: number): boolean {
    if (!Number.isFinite(nowMs)) return false;
    const w = Math.floor(nowMs / 60_000);
    if (w !== this.window) {
      this.window = w;
      this.horseOnlyUsed = 0;
    }
    if (this.horseOnlyUsed >= OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE) return false;
    this.horseOnlyUsed++;
    return true;
  }
}
