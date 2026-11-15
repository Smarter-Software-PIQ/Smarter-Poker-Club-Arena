/**
 * LIGHTNING PAIRED EVALUATION: ONE ARM OF ONE CELL (2026-11-14).
 *
 * Plays Lightning hands through the real LightningHandHost and HandController
 * (the fixture of the Lightning strength matrix, testing/lightningHostTestKit),
 * with every Horse seat decided by HorseLogic.decide on the snapshot the host
 * builds through buildLightningHorseSnapshot, and learning the way the worker
 * learns. It differs from the strength matrix in what the owner asked the
 * Lightning programme to measure:
 *
 *   - the real Lightning contract: a big-blind ante, 4 to 6 players, NLH, PLO4
 *     and PLO5, the rake the engine computes for the stake (no override), 50 /
 *     100 / 200 bb stacks, a new table composition every hand so the measured
 *     seat rotates through every position;
 *   - one arm is a set of decide options (and, until a producer exists, an
 *     optional snapshot patch) applied to the SUBJECT seats only; every other
 *     Horse plays the baseline options. Two arms of one cell are played on the
 *     same deals, seats, opponents and per-hand random streams, so the
 *     per-hand difference is the paired sample;
 *   - participation is reported with its quality: opportunities, voluntary
 *     entries, first-in raise / limp / fold, the big blind's answer by price,
 *     and the strength of the range that enters and that sees a flop.
 *
 * Measurement plumbing only: no production caller, no database, no writer.
 * Run inside vitest (the fixture is built on vi.fn and fake timers). The
 * caller supplies a FRESH module graph per arm (see LightningPairedEval.test.ts
 * loadArm): the equity caches are module state, and a warm cache changes how
 * many random draws a decision consumes.
 */
import { performance } from 'node:perf_hooks';
import { vi } from 'vitest';
import { HorseLogic } from '../engine/HorseLogic.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../engine/HorseEval.js';
import { equityGovernor } from '../engine/EquityLoadGovernor.js';
import { HorseMind } from '../engine/HorseMind.js';
import { completedHandActionsForMind } from '../engine/horseDecision/completedHandActions.js';
import { horseMindHandFromCompletion } from '../engine/HorseMindHandIdentity.js';
import { observeHandResults, resetWinnerReads } from '../engine/HorseWinnerRead.js';
import type { CompletedHandObservation } from '../engine/horseDecision/index.js';
import { EXPLOITER_POLICIES, type ExploiterPolicy } from '../benchmark/ExploiterLeague.js';
import { styleLeagueField } from '../benchmark/StyleReadLeagueField.js';
import type { LeagueSeatSpot } from '../benchmark/HorseLeague.js';
import * as kit from '../testing/lightningHostTestKit.js';
import { horsePreflopStrength } from './LightningHorseEarlyFold.js';
import { buildLightningHorseSnapshot } from './LightningHorse.js';
import {
  LIGHTNING_EVAL_BIG_BLIND,
  LIGHTNING_EVAL_SMALL_BLIND,
  bbPriceBucket,
  emptyPositionStats,
  lightningEvalMix,
  lightningEvalPosition,
  strengthBin,
  type LightningEvalArmResult,
  type LightningEvalArmSpec,
  type LightningEvalCell,
  type LightningEvalField,
  type LightningEvalHandRecord,
  type LightningEvalPositionStats,
  type LightningEvalSubjectHand,
} from './LightningPairedEval.test-support.js';

type Decision = { action: string; amount?: number };

/**
 * The scripted opponents, each an EXISTING maintained definition (nothing is
 * redefined here). `null` = the seat is a Horse on the baseline options, sat
 * as a person nobody has met (a fresh id every hand).
 */
function fieldPolicy(field: LightningEvalField): ExploiterPolicy | null {
  const style = styleLeagueField();
  switch (field) {
    case 'all_horse':
    case 'unknown':
      return null;
    case 'station':
      return EXPLOITER_POLICIES.calling_station;
    case 'nit':
      return style.lp_tight!;
    case 'tight_value':
      return style.lp_value_heavy_passive!;
    case 'tag_regular':
      return EXPLOITER_POLICIES.reg_tag;
    case 'maniac':
      return EXPLOITER_POLICIES.maniac;
    case 'gear_changer':
      return style.lp_time_shifter!;
    case 'three_bet_heavy':
      return EXPLOITER_POLICIES.light_3bet;
  }
}

/** The production worker's learning steps, in process (as the strength matrix). */
function observeLikeTheWorker(o: CompletedHandObservation): void {
  const completed = completedHandActionsForMind(o.actions as never, o.scope ?? null);
  const identity = horseMindHandFromCompletion(o as never);
  if (completed && identity) {
    const prev = HorseMind.currentScope();
    HorseMind.setDecisionScope(completed.scope);
    try {
      HorseMind.observe(completed.actions as never, [], identity);
    } finally {
      HorseMind.setDecisionScope(prev);
    }
  }
  HorseMind.observeHandComplete(
    o.handKey,
    o.actions as never,
    o.bigBlind,
    o.showdown ?? null,
    o.scope ?? null,
    false,
    o.riverCallContext,
    o.retainedRiverCalls
  );
  observeHandResults(o.handKey, o.results, o.bigBlind);
}

const VOLUNTARY = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const BETTING = ['preflop', 'flop', 'turn', 'river'];
const HERO = kit.uid(555_555);
const villainId = (j: number) => kit.uid(777_000 + j);
const HORSE_POOL = 24;

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export async function playLightningEvalArm(input: {
  cell: LightningEvalCell;
  arm: LightningEvalArmSpec;
  hands: number;
  seed: number;
  baselineDecideOpts: Record<string, unknown>;
  /** Sets the seeded deck's state (the caller owns the CryptoRandom mock). */
  setDeckState: (state: number) => void;
}): Promise<LightningEvalArmResult> {
  const { cell, arm } = input;
  const n = cell.players;
  const bb = LIGHTNING_EVAL_BIG_BLIND;
  const policy = fieldPolicy(cell.field);
  const villains = cell.field === 'all_horse' ? 0 : Math.min(cell.villains ?? 1, n - 1);
  const scope = arm.scope ?? 'hero';
  const cellKey = lightningEvalMix(
    input.seed,
    cell.variant.length * 131 + n * 17 + cell.stackBB,
    cell.field.length * 7919 + cell.field.charCodeAt(0) * 31 + villains
  );
  const previousRng = saveFastRandom();
  equityGovernor.__setScaleForTest(1);
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const byPosition: Record<string, LightningEvalPositionStats> = {};
  const total = emptyPositionStats();
  const hands: LightningEvalHandRecord[] = [];
  const latency: number[] = [];
  const counters = {
    decisions: 0,
    subjectDecisions: 0,
    illegalActions: 0,
    illegalAmounts: 0,
    policyFallbacks: 0,
    decideThrows: 0,
    villainRejected: 0,
    unsettledHands: 0,
    buttonMismatch: 0,
    armOptionKeysSeen: [] as string[],
  };
  let rakeConfig: unknown = null;
  let tableRake = 0;
  let subjectRake = 0;
  try {
    vi.setSystemTime(Date.UTC(2026, 9, 24));
    HorseMind.reset();
    resetWinnerReads();
    const baseOpts = {
      telemetry: false,
      decisionTimeMs: Date.UTC(2026, 9, 24),
      phase13EvidenceMode: true,
      ...input.baselineDecideOpts,
    };
    const armOpts = { ...baseOpts, ...(arm.decideOpts ?? {}) };
    counters.armOptionKeysSeen = Object.keys(arm.decideOpts ?? {}).sort();
    for (let h = 0; h < input.hands; h++) {
      // Every random stream of the hand is a function of (seed, cell, hand)
      // alone, so a divergence in one hand never shifts the cards, the brain's
      // jitter or the opponents' dice of a later hand.
      input.setDeckState(lightningEvalMix(cellKey, h, 1));
      seedFastRandom(lightningEvalMix(cellKey, h, 2));
      const hostRandom = xorshift(lightningEvalMix(cellKey, h, 3));
      const pick = xorshift(lightningEvalMix(cellKey, h, 4));
      // A new table every hand: the hero rotates through every seat, the
      // scripted opponents rotate around it, the other Horses are drawn from a
      // pool the hero meets again (as in a real pool).
      const formed = kit.formedHand(n, 1_000_000 + h * 100);
      const heroSlot = h % n;
      const players: string[] = Array.from({ length: n }, () => '');
      players[heroSlot] = HERO;
      const villainIds: string[] = [];
      for (let j = 0; j < villains; j++) {
        const slot = (heroSlot + 1 + ((Math.floor(h / n) + j) % (n - 1))) % n;
        const id = cell.field === 'unknown' ? kit.uid(900_000 + h * 10 + j) : villainId(j);
        players[slot] = id;
        villainIds.push(id);
      }
      const pool = Array.from({ length: HORSE_POOL }, (_, k) => kit.uid(100_000 + k));
      for (let i = 0; i < n; i++) {
        if (players[i]) continue;
        const k = Math.floor(pick() * pool.length);
        players[i] = pool.splice(k, 1)[0]!;
      }
      formed.players = players;
      formed.bb = players[0]!;
      formed.sb = players[1]!;
      formed.btn = players[n - 1]!;
      const seatOf = (id: string) => {
        const i = players.indexOf(id);
        return i === 0 ? 2 : i === 1 ? 1 : i + 1;
      };
      const horseIds = new Set(players.filter((p) => !villainIds.includes(p)));
      const subjectIds = scope === 'all_horses' ? horseIds : new Set([HERO]);
      const t = kit.buildHost(
        formed,
        Array.from({ length: n }, () => cell.stackBB * bb),
        {
          horses: horseIds,
          rules: {
            game_variant: cell.variant,
            big_blind: bb,
            small_blind: LIGHTNING_EVAL_SMALL_BLIND,
            max_players: 6,
            // THE LIGHTNING CONTRACT: a big-blind ante of one big blind.
            ante_enabled: true,
            ante: bb,
            big_blind_ante_enabled: true,
            // No override: the engine computes the published rake for the stake.
            rake_percent: null,
            rake_cap_bb: null,
          },
          deps: { random: hostRandom },
        }
      );
      vi.mocked(t.backend.nextHandNumber).mockResolvedValue(1_000_001 + h);
      const decisionLog: string[] = [];
      const bbFirstPriced = new Map<string, { price: number; action: string; early: boolean }>();
      let villainStep = 0;
      try {
        const lane = t.horseLane.raw;
        lane.decideFast.mockImplementation(async (snap: any) => {
          const uid: string = snap.player.user_id;
          const isSubject = subjectIds.has(uid);
          const used = isSubject && arm.snapshotPatch ? arm.snapshotPatch(snap) : snap;
          const gs = used.gameState;
          if (rakeConfig === null) rakeConfig = structuredClone(gs.rakeConfig ?? null);
          if (gs.dealerSeat !== n) counters.buttonMismatch++;
          const t0 = performance.now();
          let decision: any;
          try {
            decision = HorseLogic.decide(
              used.player,
              gs,
              used.style,
              used.mods ?? {},
              (isSubject ? armOpts : baseOpts) as never
            );
          } catch (err) {
            counters.decideThrows++;
            throw err;
          }
          const ms = performance.now() - t0;
          counters.decisions++;
          // An early look carries the host's own fence suffix. The game state
          // cannot tell: asIfToAct reports the hero as the seat to act.
          const early = String(snap.fence ?? '').endsWith(':early');
          const legal: string[] = gs.legalActions ?? [];
          if (isSubject) {
            counters.subjectDecisions++;
            latency.push(ms);
            if (!legal.includes(decision.action)) counters.illegalActions++;
            else if (
              (decision.action === 'bet' || decision.action === 'raise') &&
              gs.minRaiseTo != null &&
              gs.maxRaiseTo != null &&
              (Number(decision.amount) < gs.minRaiseTo - 0.011 ||
                Number(decision.amount) > gs.maxRaiseTo + 0.011)
            )
              counters.illegalAmounts++;
            if (decision.policyFallback) counters.policyFallbacks++;
            if (
              gs.stage === 'preflop' &&
              gs.heroSeat === 2 &&
              gs.toCall > 0.005 &&
              !bbFirstPriced.has(uid)
            )
              bbFirstPriced.set(uid, {
                price: gs.toCall / (Number(gs.pot) + gs.toCall),
                action: String(decision.action),
                early,
              });
          }
          decisionLog.push(
            `${uid.slice(-6)}|${gs.stage}|${early ? 'e' : 't'}|${decision.action}|${
              decision.amount === undefined ? '' : Math.round(Number(decision.amount) * 100)
            }`
          );
          return {
            type: 'FAST_RESULT',
            requestId: 1,
            planBinding: null,
            planIssueDisposition: 'no_effects',
            generation: snap.generation,
            fence: snap.fence,
            decision,
            rngBefore: 0,
            rngAfter: 0,
            computeMs: 1,
            governorScale: 1,
            effects: [],
          } as never;
        });
        lane.observeCompletedHand.mockImplementation(async (o: CompletedHandObservation) => {
          observeLikeTheWorker(o);
          return { type: 'ACK' } as never;
        });
        await t.host.start();
        for (let i = 0; i < 600 && t.host.lifecycle === 'dealing'; i++) {
          const st = t.host.peekState();
          const cur = st?.players.find((x: any) => x.seat === st.currentPlayerSeat);
          if (cur && villainIds.includes(cur.user_id) && BETTING.includes(st!.stage)) {
            const hc = (t.host as any).hc;
            const auth = hc.getAuthoritativeActionState(cur.user_id);
            const legal: string[] = auth?.legalActions ?? [];
            if (legal.length) {
              const cards = (t.host as any).holeCards.get(cur.user_id)?.cards ?? [];
              const horse = (): Decision => {
                const snap = buildLightningHorseSnapshot({
                  hc,
                  userId: cur.user_id,
                  seat: cur.seat,
                  horseProfile: undefined,
                  variant: cell.variant,
                  bigBlind: bb,
                  smallBlind: LIGHTNING_EVAL_SMALL_BLIND,
                  ante: bb,
                  bigBlindAnte: true,
                  allInOrFold: false,
                  actionTimeSeconds: 15,
                  actions: (t.host as any).actions ?? [],
                  generation: 0,
                  fence: 'lightning-eval-unknown',
                  turnStartMs: Date.now(),
                  now: Date.now(),
                });
                const d = HorseLogic.decide(
                  snap.player,
                  snap.gameState,
                  snap.style,
                  snap.mods ?? {},
                  baseOpts as never
                );
                return { action: String(d.action), amount: d.amount };
              };
              const spot: LeagueSeatSpot = {
                variant: cell.variant,
                isPotLimit: cell.variant !== 'nlh',
                stage: st!.stage,
                seatIdx: cur.seat - 1,
                numSeats: n,
                dealerSeat: st!.dealerSeat - 1,
                bigBlind: bb,
                cards: [...cards],
                board: [...st!.communityCards],
                pot: Number(st!.pot) || 0,
                toCall: auth.toCall ?? 0,
                currentBet: st!.currentBet,
                myBet: cur.bet,
                stack: cur.stack,
                liveCount: st!.players.filter((p: any) => !p.is_folded).length,
                legalActions: legal,
                minRaiseTo: auth.minRaiseTo ?? null,
                maxRaiseTo: auth.maxRaiseTo ?? null,
                history: st!.actionHistory,
                userId: cur.user_id,
                horseDecide: () => horse(),
              };
              // The opponent's dice are its own stream, a function of the hand
              // and its decision index: it never moves the Horses' jitter.
              const saved = saveFastRandom();
              seedFastRandom(lightningEvalMix(cellKey, h, 1000 + villainStep++));
              let d: Decision;
              try {
                d = policy ? policy(spot, horse) : horse();
              } finally {
                restoreFastRandom(saved);
              }
              const r = t.host.handlePlayerAction(cur.user_id, d.action, d.amount);
              if (!r.success) {
                counters.villainRejected++;
                t.host.handlePlayerAction(cur.user_id, legal.includes('check') ? 'check' : 'fold');
              }
            }
          }
          await vi.advanceTimersByTimeAsync(400);
        }
        const settled = t.calls.settle[0];
        const accepted = (((t.host as any).actions ?? []) as Array<Record<string, any>>).filter(
          (a) => VOLUNTARY.has(String(a.action)) && a.origin !== 'forced'
        );
        const pre = accepted.filter((a) => a.stage === 'preflop');
        const preFolds = new Set(pre.filter((a) => a.action === 'fold').map((a) => a.userId));
        const reachedFlop = n - preFolds.size >= 2;
        const subjects: LightningEvalSubjectHand[] = [];
        if (!settled) counters.unsettledHands++;
        else {
          tableRake += Number(settled.rake) || 0;
          const wonTotal = settled.results.reduce((s: number, r: any) => s + (r.won || 0), 0);
          for (const id of subjectIds) {
            const res = settled.results.find((r: any) => r.playerId === id);
            if (!res) continue;
            const seat = seatOf(id);
            const position = lightningEvalPosition(seat, n);
            const mine = pre.filter((a) => a.userId === id);
            const firstIdx = pre.findIndex((a) => a.userId === id);
            const before = firstIdx < 0 ? pre : pre.slice(0, firstIdx);
            const unopened = before.every((a) => a.action === 'fold');
            const first = mine[0]?.action as string | undefined;
            const vpip = mine.some((a) => ['call', 'bet', 'raise', 'all_in'].includes(a.action));
            const pfr = mine.some(
              (a) =>
                a.action === 'bet' ||
                a.action === 'raise' ||
                (a.action === 'all_in' && a.isFullRaise !== false)
            );
            // A WALK: the big blind was never asked anything (everyone folded).
            const walk = seat === 2 && mine.length === 0 && preFolds.size === n - 1;
            const firstIn =
              seat !== 2 && first !== undefined && unopened
                ? first === 'fold'
                  ? 'fold'
                  : first === 'call'
                    ? 'limp'
                    : 'raise'
                : null;
            const cards = (t.host as any).holeCards.get(id)?.cards ?? [];
            const strength = horsePreflopStrength(cards, cell.variant);
            const net = (res.won - res.contributed) / bb;
            if (res.won > 0 && wonTotal > 0)
              subjectRake += ((Number(settled.rake) || 0) * res.won) / wonTotal;
            const bbAns = bbFirstPriced.get(id) ?? null;
            const row: LightningEvalSubjectHand = {
              id: id.slice(-6),
              seat,
              position,
              netBB: Math.round(net * 1000) / 1000,
              vpip,
              pfr,
              walk,
              firstIn,
              sawFlop: reachedFlop && !preFolds.has(id),
              fastFold: res.foldType === 'fast',
              strength: Number.isFinite(strength) ? Math.round(strength * 10000) / 10000 : -1,
              bbPrice: bbAns ? Math.round(bbAns.price * 10000) / 10000 : null,
              bbAnswer: bbAns ? bbAns.action : null,
              bbAnswerEarly: bbAns ? bbAns.early : null,
            };
            subjects.push(row);
            for (const s of [total, (byPosition[position] ??= emptyPositionStats())]) {
              s.hands++;
              s.netBB += row.netBB;
              if (walk) s.walks++;
              if (vpip) s.vpip++;
              if (pfr) s.pfr++;
              if (row.fastFold) s.fastFolds++;
              if (firstIn) {
                s.firstInOpportunities++;
                if (firstIn === 'raise') s.firstInRaise++;
                else if (firstIn === 'limp') s.firstInLimp++;
                else s.firstInFold++;
              }
              if (vpip && row.strength >= 0) {
                s.entryStrengthSum += row.strength;
                s.entryStrengthBins[strengthBin(row.strength)]!++;
              }
              if (row.sawFlop) {
                s.sawFlop++;
                if (row.strength >= 0) {
                  s.flopStrengthSum += row.strength;
                  s.flopStrengthBins[strengthBin(row.strength)]!++;
                }
              }
              if (bbAns) {
                const b = (s.bigBlindByPrice[bbPriceBucket(bbAns.price)] ??= {
                  n: 0,
                  fold: 0,
                  call: 0,
                  raise: 0,
                  early: 0,
                });
                b.n++;
                if (bbAns.action === 'fold') b.fold++;
                else if (bbAns.action === 'call' || bbAns.action === 'check') b.call++;
                else b.raise++;
                if (bbAns.early) b.early++;
              }
            }
          }
        }
        hands.push({
          h,
          settled: Boolean(settled),
          rakeBB: settled ? Math.round(((Number(settled.rake) || 0) / bb) * 1000) / 1000 : 0,
          subjects,
          decisions: decisionLog,
          accepted: accepted.map(
            (a) =>
              `${String(a.userId).slice(-6)}|${a.stage}|${a.action}|${Math.round(Number(a.amount ?? 0) * 100)}`
          ),
        });
      } finally {
        await t.host.abort('lightning_eval_done');
      }
    }
    const sorted = [...latency].sort((a, b) => a - b);
    return {
      arm: arm.name,
      scope,
      hands,
      total,
      byPosition,
      rakeConfig,
      tableRakeBBPer100: hands.length ? (tableRake / bb / hands.length) * 100 : 0,
      subjectRakeBBPer100: total.hands ? (subjectRake / bb / total.hands) * 100 : 0,
      counters,
      latencyMs: {
        n: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.length ? sorted[sorted.length - 1]! : 0,
      },
    };
  } finally {
    vi.useRealTimers();
    restoreFastRandom(previousRng);
    equityGovernor.__setScaleForTest(null);
    HorseMind.reset();
    resetWinnerReads();
  }
}
