/**
 * THE HONEST GRADING HARNESS (2026-11-27, lead-8 lane L2). One place for the league mirror and the scripted-opponent
 * probe that grade a Horse option, with the null drift removed at its root and a same-seed no-op arm built in.
 *
 * Why it exists. The lane harnesses (PLO mirror/probe copies) measured noise as signal: a no-op (option OFF in both
 * arms) read -0.7 +/- 1.6 bb/100 on one seed with 242 divergent deals of 12,000. Causes, each fixed here:
 *  1. ONE SHARED BET-READ STORE (HorseOmahaBetRead is module-global): the world that plays a deal second read the first
 *     world's learning of that same deal. Here every world owns its store (omahaBetReadNewStore / UseStore seam).
 *  2. NO PAIR HAND CLOCK: playHand fell back to the process-wide counter, so the two worlds of a deal got different
 *     hand keys. Here both worlds of a deal play on leaguePairHandClock(deal, seed).
 *  3. WALL-CLOCK MOOD: decisions read the hour they ran in. Here every decision carries dealMoodClockMs(handSeed).
 *  4. HISTORY DIVERGENCE (probes): two persistent sandboxes part after the first changed deal and every later deal
 *     differs. fork (default) clones the ON world's whole state (sandbox, bet-read store, street record, scripted
 *     seat state) before each deal and plays the OFF arm and the no-op arm from that clone first.
 * Every world also keeps its own public street record (first answers to a street's first wager by size, unopened
 * wagers), served through HorseMind's lifetime street record provider as the live OPPONENT-HUD packet is, counted
 * from completed hands only. Cards: a world learns the bet-read only from cards SHOWN at a showdown.
 *
 * The no-op arm (noop: true, the default) plays the same deals with the option OFF on both sides, so every grade
 * reports ON-minus-OFF, the no-op's own reading, and ON-minus-noop (paired by deal). With the fixes above the no-op is
 * 0 within 0.1 bb/100 (HorseGradeHarness.test.ts); a grade is read as ON-minus-noop.
 *
 * Offline only: no production caller. Installs its stores and provider while it runs and restores the module
 * bet-read store and clears the provider when it returns.
 */
import type { Card, HandStage } from '../types.js';
import type { HorseDecideOpts } from '../engine/HorseLogic.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { HorseMind, type HorseMindSandbox } from '../engine/HorseMind.js';
import {
  omahaDrawQuality,
  restoreFastRandom,
  saveFastRandom,
  scoreOmahaHiPartial,
} from '../engine/HorseEval.js';
import {
  OMAHA_BET_READ_VARIANTS,
  omahaBetReadCloneStore,
  omahaBetReadLearn,
  omahaBetReadNewStore,
  omahaBetReadUseStore,
  type OmahaBetReadStore,
} from '../engine/HorseOmahaBetRead.js';
import { exploiterPopulation, exploiterSpotHelpers } from './ExploiterLeague.js';
import {
  dealMoodClockMs,
  leaguePairHandClock,
  playHand,
  type LeagueGameContext,
  type LeagueHandObserver,
  type LeagueHumanField,
  type LeagueSeatSpot,
} from './HorseLeague.js';

const BB = 2;
const HY = HORSE_HYBRID_PROFILES.cash;
const CASH: LeagueGameContext = { gameMode: 'cash', format: 'cash', ante: 0 };

type Street = 'turn' | 'river';
type Players = 'hu' | 'mw';
/** street, players, 'small' | 'big' | 'U' (unopened action), 1 = fold (answer) or first wager (unopened) */
type RecEv = [Street, Players, 'small' | 'big' | 'U', 0 | 1];

/** One simulated world: its own Horse memory, bet-read store, public street record and scripted-seat state. */
export class GradeWorld {
  sb: HorseMindSandbox = HorseMind.createSandbox();
  store: OmahaBetReadStore = omahaBetReadNewStore();
  rec = new Map<string, RecEv[]>();
  /** state a scripted seat keeps between hands (cloned with the world) */
  state: Record<string, unknown> = {};
  learnBetRead = true;
  private acts: Array<Record<string, unknown>> = [];
  private pending: Array<[string, RecEv]> = [];
  private street: {
    stage: HandStage;
    bet: { seat: number; big: boolean; players: Players } | null;
    answered: Set<number>;
  } | null = null;
  private static handNo = 0;
  constructor(public readonly tag: string) {}

  clone(tag: string): GradeWorld {
    const w = new GradeWorld(tag);
    w.sb = structuredClone(this.sb);
    w.store = omahaBetReadCloneStore(this.store);
    w.rec = new Map([...this.rec].map(([k, v]) => [k, v.map((e) => [...e] as RecEv)]));
    w.state = structuredClone(this.state);
    w.learnBetRead = this.learnBetRead;
    return w;
  }

  /** Make this world's stores the ones every decision reads. */
  enter(): void {
    omahaBetReadUseStore(this.store);
    const rec = this.rec;
    HorseMind.setOmahaLifetimeStreetRecordProvider({
      unopenedWagerRecord(userId: string, _game: string, street: string, players: string) {
        const l = rec.get(userId);
        if (!l) return null;
        let opps = 0;
        let bets = 0;
        for (const e of l)
          if (e[0] === street && e[1] === players && e[2] === 'U') {
            opps++;
            bets += e[3];
          }
        return opps > 0 ? { bets, opps } : null;
      },
      stabSizeRecord: () => null,
      firstWagerFoldRecord(
        userId: string,
        _game: string,
        street: string,
        players: string,
        size: string
      ) {
        const l = rec.get(userId);
        if (!l) return null;
        let opps = 0;
        let folds = 0;
        for (const e of l)
          if (e[0] === street && e[1] === players && e[2] === size) {
            opps++;
            folds += e[3];
          }
        return opps > 0 ? { folds, opps } : null;
      },
    });
  }

  observer(variant: string, isHuman: (i: number) => boolean): LeagueHandObserver {
    const uid = (i: number) => (isHuman(i) ? `league-human-${i + 1}` : `league-${i + 1}`);
    return {
      onAction: (e) => {
        this.acts.push({
          user_id: uid(e.seatIdx),
          action: e.action,
          amount: e.amount,
          stage: e.stage,
          origin: isHuman(e.seatIdx) ? 'player' : 'horse_policy',
          publicNode: { pot: e.pot, toCall: e.toCall },
        });
        if (e.stage !== 'turn' && e.stage !== 'river') return;
        if (!this.street || this.street.stage !== e.stage)
          this.street = { stage: e.stage, bet: null, answered: new Set() };
        const s = this.street;
        const players: Players = e.liveBefore <= 2 ? 'hu' : 'mw';
        const wager = e.action === 'bet' || e.action === 'raise' || e.action === 'all_in';
        if (!s.bet) {
          if (e.action === 'check' || wager)
            this.pending.push([uid(e.seatIdx), [e.stage, players, 'U', wager ? 1 : 0]]);
          if (wager)
            s.bet = {
              seat: e.seatIdx,
              big: e.action === 'all_in' || (e.pot > 0 ? e.amount / e.pot : 1) > 0.7,
              players,
            };
          return;
        }
        if (e.seatIdx === s.bet.seat || s.answered.has(e.seatIdx)) return;
        s.answered.add(e.seatIdx);
        this.pending.push([
          uid(e.seatIdx),
          [e.stage, s.bet.players, s.bet.big ? 'big' : 'small', e.action === 'fold' ? 1 : 0],
        ]);
      },
      onEnd: (e) => {
        for (const [u, ev] of this.pending) {
          const l = this.rec.get(u) ?? [];
          l.push(ev);
          this.rec.set(u, l);
        }
        this.pending = [];
        this.street = null;
        const acts = this.acts;
        this.acts = [];
        if (!this.learnBetRead || !OMAHA_BET_READ_VARIANTS.has(variant)) return;
        const shown = new Map<string, Card[]>();
        const showdown: Array<{ user_id: string; mucked: boolean }> = [];
        if (!e.endedByFolds)
          e.folded.forEach((f, i) => {
            if (!f) {
              shown.set(uid(i), e.cards[i]!);
              showdown.push({ user_id: uid(i), mucked: false });
            }
          });
        omahaBetReadLearn({
          handKey: `${this.tag}-${++GradeWorld.handNo}`,
          variant,
          mode: 'cash',
          actions: acts as never,
          board: e.board,
          shown,
          showdown,
          boardCount: 1,
          speed: 'table',
        } as never);
      },
    };
  }
}

/** mean and standard error, x 100 (per 100 hands) */
export function gradeStat(x: readonly number[]): { mean: number; se: number } {
  const n = x.length;
  if (n === 0) return { mean: 0, se: 0 };
  const m = x.reduce((p, q) => p + q, 0) / n;
  const v = x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, n - 1);
  return { mean: 100 * m, se: 100 * Math.sqrt(v / n) };
}
const round2 = (r: { mean: number; se: number }) => ({
  mean: +r.mean.toFixed(2),
  se: +r.se.toFixed(2),
});

const handSeedOf = (seed: number, c: number) => (seed ^ (c * 2654435761)) >>> 0 || 1;

/** Run `fn` with the ambient RNG, bet-read store and record provider restored afterwards. */
function bracket<T>(fn: () => Promise<T>): Promise<T> {
  const rng = saveFastRandom();
  const before = omahaBetReadUseStore(omahaBetReadNewStore());
  omahaBetReadUseStore(before);
  return fn().finally(() => {
    restoreFastRandom(rng);
    omahaBetReadUseStore(before);
    HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  });
}

export interface GradeMirrorSpec {
  variant: string;
  seats: number;
  stackBB: number;
  pairs: number;
  seed: number;
  /** the decide options every seat plays (the live switch rows) */
  base: HorseDecideOpts;
  /** what the ON seats add */
  on: HorseDecideOpts;
  /** play the same deals with ON = {} too (default true) */
  noop?: boolean;
  /** Horse memory learning (default true) */
  memory?: boolean;
  context?: LeagueGameContext;
  extra?: (seatIdx: number) => HorseDecideOpts;
  onProgress?: (pairsDone: number) => void;
}
export interface GradeArm {
  mean: number;
  se: number;
  /** mirror: pairs whose two passes did not settle identically (expected 0 only for a no-op);
   *  probe: deals whose two arms netted differently */
  divergent: number;
}
export interface GradeMirrorResult {
  pairs: number;
  hands: number;
  /** ON seats minus OFF seats, bb/100 per seat */
  on: GradeArm;
  noop: GradeArm | null;
  /** ON-minus-noop, paired by deal */
  onMinusNoop: { mean: number; se: number } | null;
  illegal: number;
  truncated: number;
}

/**
 * League mirror: every seat a Horse on the hybrid cash profile; even seats play base+on and odd seats base in pass 1,
 * swapped in pass 2 (duplicate deals); one world per pass for the whole run.
 */
export function gradeMirror(spec: GradeMirrorSpec): Promise<GradeMirrorResult> {
  return bracket(async () => {
    const { variant, seats, stackBB, pairs, seed, base, on } = spec;
    const noop = spec.noop !== false;
    const memory = spec.memory !== false;
    const ctx = spec.context ?? CASH;
    const counters = { illegal: 0, truncated: 0 };
    const arm = (armOn: HorseDecideOpts, tag: string) => {
      const w1 = new GradeWorld(`${tag}1`);
      const w2 = new GradeWorld(`${tag}2`);
      const diffs: number[] = [];
      let divergent = 0;
      const one = (w: GradeWorld, parity: number, c: number) => {
        const handSeed = handSeedOf(seed, c);
        const mood = dealMoodClockMs(handSeed);
        w.enter();
        const cfg = (i: number): HorseDecideOpts => ({
          ...(i % 2 === parity ? { ...base, ...armOn } : base),
          ...(spec.extra?.(i) ?? {}),
          decisionTimeMs: mood,
        });
        return playHand(
          handSeed,
          (c % seats) + 1,
          cfg,
          counters,
          w.sb,
          variant,
          seats,
          stackBB,
          ctx,
          () => ({ ...HY.mods }),
          undefined,
          () => HY.style,
          memory,
          w.observer(variant, () => false),
          leaguePairHandClock(c, seed)
        );
      };
      const perSeat = (net: number[], parity: number) => {
        let a = 0,
          b = 0,
          na = 0,
          nb = 0;
        net.forEach((x, i) => {
          if (i % 2 === parity) {
            a += x;
            na++;
          } else {
            b += x;
            nb++;
          }
        });
        return (a / na - b / nb) / 2 / BB;
      };
      return {
        play(c: number) {
          const n1 = one(w1, 0, c);
          const n2 = one(w2, 1, c);
          // exact mirror: seat i of pass 2 nets what the mirror seat of pass 1 netted, i.e. per-seat difference cancels
          const d = (perSeat(n1, 0) + perSeat(n2, 1)) / 2;
          if (n1.some((x, i) => x !== n2[i])) divergent++;
          diffs.push(d);
          return d;
        },
        diffs,
        get divergent() {
          return divergent;
        },
      };
    };
    const A = arm(on, 'mon');
    const N = noop ? arm({}, 'mno') : null;
    for (let c = 0; c < pairs; c++) {
      if (c > 0 && (c & 0x0f) === 0) await new Promise((r) => setImmediate(r));
      A.play(c);
      N?.play(c);
      if (spec.onProgress && c % 1000 === 999) spec.onProgress(c + 1);
    }
    const onR = { ...round2(gradeStat(A.diffs)), divergent: A.divergent };
    const noR = N ? { ...round2(gradeStat(N.diffs)), divergent: N.divergent } : null;
    return {
      pairs,
      hands: 2 * pairs,
      on: onR,
      noop: noR,
      onMinusNoop: N ? round2(gradeStat(A.diffs.map((x, i) => x - N.diffs[i]!))) : null,
      illegal: counters.illegal,
      truncated: counters.truncated,
    };
  });
}

/** A scripted seat: built per world so it may keep state in world.state (cloned on fork). */
export type GradeSeatPolicyFactory = (
  world: GradeWorld
) => (s: LeagueSeatSpot) => { action: string; amount?: number };

export interface GradeProbeSpec {
  variant: string;
  seats: number;
  stackBB: number;
  deals: number;
  seed: number;
  base: HorseDecideOpts;
  on: HorseDecideOpts;
  /** seat 0's policy */
  policy: GradeSeatPolicyFactory;
  /** clone the ON world before each deal; the OFF and no-op arms play from the clone (default true) */
  fork?: boolean;
  noop?: boolean;
  memory?: boolean;
  context?: LeagueGameContext;
  onProgress?: (dealsDone: number) => void;
}
export interface GradeProbeResult {
  deals: number;
  /** the Horses' net (seats 1..), bb/100 of the deal, ON arm and OFF arm */
  horsesOn: { mean: number; se: number };
  horsesOff: { mean: number; se: number };
  /** ON minus OFF paired by deal */
  on: GradeArm;
  noop: GradeArm | null;
  onMinusNoop: { mean: number; se: number } | null;
  illegal: number;
  truncated: number;
}

/**
 * Scripted-opponent probe: seat 0 plays `policy` (it may call s.horseDecide to play the production Horse), every other
 * seat is a Horse on base+on (ON world) or base (OFF world). Result = the Horses' combined net per deal.
 */
export function gradeProbe(spec: GradeProbeSpec): Promise<GradeProbeResult> {
  return bracket(async () => {
    const { variant, seats, stackBB, deals, seed, base, on } = spec;
    const fork = spec.fork !== false;
    const noop = spec.noop !== false;
    const memory = spec.memory !== false;
    const ctx = spec.context ?? CASH;
    const counters = { illegal: 0, truncated: 0 };
    const pop = exploiterPopulation(variant === 'nlh' ? 'nlh' : (variant as never));
    const play = (w: GradeWorld, opts: HorseDecideOpts, c: number): number => {
      const handSeed = handSeedOf(seed, c);
      const mood = dealMoodClockMs(handSeed);
      const policy = spec.policy(w);
      const field: LeagueHumanField = {
        population: pop,
        isHuman: (i) => i === 0,
        seatPolicyOf: (i) => (i === 0 ? policy : undefined),
      };
      w.enter();
      const net = playHand(
        handSeed,
        (c % seats) + 1,
        () => ({ ...opts, decisionTimeMs: mood }),
        counters,
        w.sb,
        variant,
        seats,
        stackBB,
        ctx,
        () => ({ ...HY.mods }),
        field,
        () => HY.style,
        memory,
        w.observer(variant, (i) => i === 0),
        leaguePairHandClock(c, seed)
      );
      return -net[0]! / BB;
    };
    const onOpts = { ...base, ...on };
    let wa = new GradeWorld('pa');
    let wb = new GradeWorld('pb');
    let wn = new GradeWorld('pn');
    let wn2 = new GradeWorld('pn2');
    const a: number[] = [],
      b: number[] = [],
      nOn: number[] = [],
      nOff: number[] = [];
    for (let c = 0; c < deals; c++) {
      if (c > 0 && (c & 0x0f) === 0) await new Promise((r) => setImmediate(r));
      if (fork) {
        // both clones are taken before anything plays; the no-op clone plays LAST, so any state that leaks out of a
        // world (anything outside GradeWorld) shows up as a non-zero no-op
        wb = wa.clone('pb');
        if (noop) wn = wa.clone('pn');
        b.push(play(wb, base, c));
        a.push(play(wa, onOpts, c));
        if (noop) {
          nOff.push(b[c]!);
          nOn.push(play(wn, base, c));
        }
      } else {
        a.push(play(wa, onOpts, c));
        b.push(play(wb, base, c));
        if (noop) {
          nOn.push(play(wn, base, c));
          nOff.push(play(wn2, base, c));
        }
      }
      if (spec.onProgress && c % 1000 === 999) spec.onProgress(c + 1);
    }
    const d = a.map((x, i) => x - b[i]!);
    const dn = noop ? nOn.map((x, i) => x - nOff[i]!) : null;
    return {
      deals,
      horsesOn: round2(gradeStat(a)),
      horsesOff: round2(gradeStat(b)),
      on: { ...round2(gradeStat(d)), divergent: d.filter((x) => x !== 0).length },
      noop: dn ? { ...round2(gradeStat(dn)), divergent: dn.filter((x) => x !== 0).length } : null,
      onMinusNoop: dn ? round2(gradeStat(d.map((x, i) => x - dn[i]!))) : null,
      illegal: counters.illegal,
      truncated: counters.truncated,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Scripted seats
// ---------------------------------------------------------------------------------------------------------------
const H = exploiterSpotHelpers;
const horse = (s: LeagueSeatSpot, base: HorseDecideOpts) =>
  s.horseDecide(HY.style, { ...HY.mods }, base);

/** Never folds to a postflop bet (calls); otherwise the production Horse. */
export const gradeCallerPolicy =
  (base: HorseDecideOpts): GradeSeatPolicyFactory =>
  () =>
  (s) => {
    const d = horse(s, base);
    if (s.stage !== 'preflop' && s.toCall > 0 && d.action === 'fold') return H.call(s);
    return d;
  };

/**
 * PEOPLE'S PLO ANSWERS (people only, public actions; plo4-audit/stats.md 1,978 hands and plo5-audit/stats.md 6,003
 * hands, PLO cash with >= 1 person, no bomb pots, Nov 2026): a person's first answer to the FIRST wager of a street,
 * [count, answers] by variant . street . hu|mw . fold|raise . size (s < 0.4 pot, m < 0.8, l the rest; 'all' = every size).
 */
export const PEOPLE_PLO_ANSWERS: Readonly<
  Record<'plo4' | 'plo5', Readonly<Record<string, readonly [number, number]>>>
> = Object.freeze({
  plo4: {
    'flop.hu.fold.all': [157, 457],
    'flop.hu.fold.l': [40, 81],
    'flop.hu.fold.m': [82, 241],
    'flop.hu.fold.s': [35, 135],
    'flop.mw.fold.all': [33, 71],
    'flop.mw.fold.l': [1, 3],
    'flop.mw.fold.m': [19, 38],
    'flop.mw.fold.s': [13, 30],
    'flop.hu.raise.all': [23, 457],
    'flop.mw.raise.all': [6, 71],
    'turn.hu.fold.all': [173, 419],
    'turn.hu.fold.l': [107, 195],
    'turn.hu.fold.m': [50, 139],
    'turn.hu.fold.s': [16, 85],
    'turn.mw.fold.all': [27, 52],
    'turn.mw.fold.l': [9, 14],
    'turn.mw.fold.m': [11, 25],
    'turn.mw.fold.s': [7, 13],
    'turn.hu.raise.all': [27, 419],
    'turn.mw.raise.all': [4, 52],
    'river.hu.fold.all': [90, 158],
    'river.hu.fold.l': [57, 78],
    'river.hu.fold.m': [26, 49],
    'river.hu.fold.s': [7, 31],
    'river.mw.fold.all': [6, 7],
    'river.mw.fold.l': [4, 4],
    'river.mw.fold.m': [1, 2],
    'river.mw.fold.s': [1, 1],
    'river.hu.raise.all': [14, 158],
    'river.mw.raise.all': [0, 7],
  },
  plo5: {
    'flop.hu.fold.all': [460, 1443],
    'flop.hu.fold.l': [90, 201],
    'flop.hu.fold.m': [216, 565],
    'flop.hu.fold.s': [154, 677],
    'flop.mw.fold.all': [152, 318],
    'flop.mw.fold.l': [16, 20],
    'flop.mw.fold.m': [62, 132],
    'flop.mw.fold.s': [74, 166],
    'flop.hu.raise.all': [195, 1443],
    'flop.mw.raise.all': [22, 318],
    'turn.hu.fold.all': [458, 1116],
    'turn.hu.fold.l': [286, 523],
    'turn.hu.fold.m': [116, 299],
    'turn.hu.fold.s': [56, 294],
    'turn.mw.fold.all': [95, 199],
    'turn.mw.fold.l': [25, 42],
    'turn.mw.fold.m': [41, 87],
    'turn.mw.fold.s': [29, 70],
    'turn.hu.raise.all': [107, 1116],
    'turn.mw.raise.all': [13, 199],
    'river.hu.fold.all': [290, 435],
    'river.hu.fold.l': [155, 207],
    'river.hu.fold.m': [103, 158],
    'river.hu.fold.s': [32, 70],
    'river.mw.fold.all': [34, 39],
    'river.mw.fold.l': [16, 17],
    'river.mw.fold.m': [12, 15],
    'river.mw.fold.s': [6, 7],
    'river.hu.raise.all': [29, 435],
    'river.mw.raise.all': [1, 39],
  },
});
/** prior strength of the shrink of one cell to the next wider cell */
export const PEOPLE_PLO_SHRINK_K = 20;

/**
 * The people rate of one cell, shrunk with k = PEOPLE_PLO_SHRINK_K toward the next wider cell:
 * size cell of this variant -> the same cell of both variants pooled -> 'all' sizes of both variants pooled.
 */
export function peoplePloRate(
  variant: 'plo4' | 'plo5',
  street: string,
  players: Players,
  kind: 'fold' | 'raise',
  size: 's' | 'm' | 'l' | 'all'
): number {
  const T = PEOPLE_PLO_ANSWERS;
  const both = (key: string): [number, number] => {
    const x = T.plo4[key] ?? [0, 0];
    const y = T.plo5[key] ?? [0, 0];
    return [x[0] + y[0], x[1] + y[1]];
  };
  const K = PEOPLE_PLO_SHRINK_K;
  const shrink = ([c, n]: readonly [number, number], prior: number) => (c + K * prior) / (n + K);
  const allBoth = both(`${street}.${players}.${kind}.all`);
  const allRate = allBoth[1] > 0 ? allBoth[0] / allBoth[1] : 0;
  if (size === 'all')
    return shrink(T[variant][`${street}.${players}.${kind}.all`] ?? [0, 0], allRate);
  const pooled = shrink(both(`${street}.${players}.${kind}.${size}`), allRate);
  return shrink(T[variant][`${street}.${players}.${kind}.${size}`] ?? [0, 0], pooled);
}

/**
 * A PEOPLE-CALIBRATED PLO RESPONDER: facing the first wager of a postflop street it folds, calls or raises at PEOPLE's
 * measured rates for its variant, street, heads-up/multiway and the wager's size (peoplePloRate), folding its weakest
 * holdings first and raising (pot) with its strongest: strength = its equity against one random holding, ranked
 * against the holdings it has itself faced in that cell (a running quantile kept in world.state). The first 20 answers
 * of a cell, facing a raise, and every other decision: the production Horse. So a grade against it reads "chips
 * against an opponent who answers bets like people do".
 */
export const gradePeoplePloPolicy =
  (base: HorseDecideOpts, variant: 'plo4' | 'plo5'): GradeSeatPolicyFactory =>
  (world) =>
  (s) => {
    if (s.stage === 'preflop' || s.toCall <= 0 || H.streetRaises(s) !== 1) return horse(s, base);
    const before = Math.max(1e-9, s.pot - s.toCall);
    const ratio = s.toCall / before;
    const size = ratio < 0.4 ? 's' : ratio < 0.8 ? 'm' : 'l';
    const players: Players = s.liveCount <= 2 ? 'hu' : 'mw';
    const cell = `${s.stage}.${players}.${size}`;
    const seen = (world.state.peopleSeen ??= {}) as Record<string, number[]>;
    const arr = (seen[cell] ??= []);
    const e = H.quietEquity(s);
    const q = arr.length ? arr.reduce((n, x) => n + (x < e ? 1 : 0), 0) / arr.length : 0.5;
    arr.push(e);
    if (arr.length <= 20) return horse(s, base);
    const f = peoplePloRate(variant, s.stage, players, 'fold', size);
    const r = peoplePloRate(variant, s.stage, players, 'raise', 'all');
    if (q < f) return { action: 'fold' };
    if (q >= 1 - r && s.legalActions.some((a) => a === 'raise' || a === 'all_in'))
      return H.potWager(s, 1);
    return H.call(s);
  };

/** Calls every postflop bet, never bets postflop; preflop the production Horse (the lane harnesses' 'caller'). */
export const gradePassiveCallerPolicy =
  (base: HorseDecideOpts): GradeSeatPolicyFactory =>
  () =>
  (s) => {
    if (s.stage === 'preflop') return horse(s, base);
    return s.toCall > 0 ? H.call(s) : { action: 'check' };
  };

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
/** a deterministic unit per (seat cards, board, salt): the same in every world */
function unitOf(s: LeagueSeatSpot, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const c of [...s.cards, ...s.board]) {
    h ^= c.rank.charCodeAt(0) * 31 + c.suit.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
/** share of 300 holdings (unseen to him, drawn deterministically) that beat his Omaha hand now */
function omahaBeaten(s: LeagueSeatSpot): number {
  let rs = Math.floor(unitOf(s, 7) * 4294967296) >>> 0;
  const rnd = () => {
    rs = (rs * 1664525 + 1013904223) >>> 0;
    return rs / 4294967296;
  };
  const known = new Set([...s.cards, ...s.board].map((c) => c.rank + c.suit));
  const deck: Card[] = [];
  for (const su of SUITS)
    for (const r of '23456789TJQKA')
      if (!known.has(r + su)) deck.push({ rank: r, suit: su } as Card);
  const mine = scoreOmahaHiPartial(s.cards, s.board);
  let beat = 0;
  const n = s.cards.length;
  for (let i = 0; i < 300; i++) {
    const d = [...deck];
    const h: Card[] = [];
    for (let j = 0; j < n; j++) h.push(d.splice(Math.floor(rnd() * d.length), 1)[0]!);
    if (scoreOmahaHiPartial(h, s.board) > mine) beat++;
  }
  return beat / 300;
}
function nutFlushBlocker(s: LeagueSeatSpot): boolean {
  for (const su of SUITS) {
    const onB = s.board.filter((c) => c.suit === su);
    if (onB.length >= 3) {
      const top = 'AKQJT98765432'.split('').find((r) => !onB.some((c) => c.rank === r));
      if (
        s.cards.some((c) => c.suit === su && c.rank === top) &&
        s.cards.filter((c) => c.suit === su).length === 1
      )
        return true;
    }
  }
  return false;
}
function hasDraw(s: LeagueSeatSpot, flop: boolean): boolean {
  if (!flop && s.board.length !== 4) return false;
  try {
    const d = omahaDrawQuality(s.cards, s.board, false);
    return d.nutFlushDraw || d.straightOuts >= 8;
  } catch {
    return false;
  }
}

export interface GradeOpenerSpec {
  base: HorseDecideOpts;
  /** nobluff: value only; balanced: value + the balanced bluff share; overbluff: value + every weak blocker/draw + 40%
   *  of the other weak hands; folder: folds every bet on these streets without the top 10% */
  kind: 'nobluff' | 'balanced' | 'overbluff' | 'folder';
  /** the streets it opens on: the lane harnesses' turn+river probes, or the flop probe (flop-pp) */
  streets: 'turn_river' | 'flop';
  /** wager size, share of the pot (default 0.8 turn/river, 1.0 flop) */
  frac?: number;
  /** value = beaten by under this share of holdings (default 0.12 turn/river, 0.15 flop) */
  value?: number;
  /** who it opens against: 'hu' (default), 'mw' (two or more opponents only), 'any' */
  players?: 'hu' | 'mw' | 'any';
}
/**
 * The lane harnesses' PLO opener (plo-defence grade2, plo-bluffs grade3, river-station grade4, flop-pp gradeF,
 * plo4-audit grade-mw): the production Horse everywhere except where it may make the FIRST wager of one of its
 * streets with nothing to call; there it bets `frac` pot by its kind. Same decisions in every world.
 */
export const gradeOpenerPolicy =
  (o: GradeOpenerSpec): GradeSeatPolicyFactory =>
  () => {
    const flop = o.streets === 'flop';
    const FRAC = o.frac ?? (flop ? 1.0 : 0.8);
    const VALUE = o.value ?? (flop ? 0.15 : 0.12);
    const players = o.players ?? 'hu';
    const can = (s: LeagueSeatSpot, a: string) => s.legalActions.includes(a);
    return (s) => {
      const mine = flop ? s.stage === 'flop' : s.stage === 'turn' || s.stage === 'river';
      if (!mine) return horse(s, o.base);
      if (o.kind === 'folder') {
        if (s.toCall > 0) return omahaBeaten(s) < 0.1 ? H.call(s) : { action: 'fold' };
        return horse(s, o.base);
      }
      const seatOk = players === 'any' || (players === 'hu' ? s.liveCount === 2 : s.liveCount >= 3);
      if (s.toCall > 0 || !seatOk || !can(s, 'bet')) return horse(s, o.base);
      const out = () => H.wager(s, s.myBet + FRAC * s.pot);
      const bs = omahaBeaten(s);
      if (bs < VALUE) return out();
      const weak = bs > 0.5;
      if (o.kind === 'nobluff') return { action: 'check' };
      if (o.kind === 'balanced') {
        const b1 = FRAC / (1 + 2 * FRAC);
        const share = flop ? 1 - (1 - b1) ** 3 : s.stage === 'turn' ? 1 - (1 - b1) * (1 - b1) : b1;
        const p = Math.min(1, (VALUE * share) / (1 - share) / 0.5);
        return weak && unitOf(s, 99) < p ? out() : { action: 'check' };
      }
      if (weak && ((!flop && nutFlushBlocker(s)) || hasDraw(s, flop) || unitOf(s, 99) < 0.4))
        return out();
      return { action: 'check' };
    };
  };
