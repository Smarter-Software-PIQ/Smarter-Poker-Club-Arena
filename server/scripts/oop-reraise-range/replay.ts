/**
 * REPLAY: the out-of-position 3-bet range against a pot 4-bet (HorseOopReraiseRangeHolds; trace OOP-3BET-FOLD-TRACE.md,
 * whose scripts/tb.ts this generalizes to PLO4 / PLO5 / NLH, four positions and four opener reads).
 *
 * For each generated hand (seeded uniform deal) and depth: the Horse's decision at its out-of-position node facing one
 * open; if it re-raises, its decision at the 4-bet node (the opener re-raises the pot-sized 4-bet, or 2.3x the 3-bet in
 * NLH). One ndjson row per hand x depth. No real hole cards, no database.
 *
 *   npx tsx server/scripts/oop-reraise-range/replay.ts --variant plo5 --n 3000 --start 0 --depths 100,200,400,800 \
 *     --pos bb_co --read none --opts <production opts json> --extra '{"omahaOopReraiseRangeHoldsVsReraise":true}' \
 *     --out <file.ndjson> [--profile <durable rows json>]
 *
 * --pos   bb_co | bb_btn | sb_btn | bb_utg (Horse's seat vs opener's seat; button seat 1, six seats)
 * --read  none (empty memory) | wide (counters shaped like PFR 60%, fold to 3-bet 0) | tight (PFR 12%, fold to 3-bet
 *         70%) | profile (the --profile rows, e.g. the real opener's durable row)
 */
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { performance as perf } from 'node:perf_hooks';
import { HorseLogic } from '../../src/engine/HorseLogic.js';
import { HorseMind } from '../../src/engine/HorseMind.js';
import { seedFastRandom } from '../../src/engine/HorseEval.js';
import { seedHorseBetSizeRandom } from '../../src/engine/horsePublicBetSize.js';
import { seedHorseTimingRandom } from '../../src/engine/horsePublicActionTime.js';
import { enableBrainTelemetry, drainFires } from '../../src/engine/BrainTelemetry.js';
import { stateAt, actionKind } from '../../src/engine/HorseComplaintReplay.js';
import { HORSE_HYBRID_PROFILES } from '../../src/engine/HorseHybridProfile.js';
import { omahaHandClass } from '../../src/engine/HorseHandClasses.js';
import { holdemClassOf } from '../../src/engine/HorseHoldemTournamentAllInCall.js';

const arg = (k: string, d?: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const VARIANT = arg('variant', 'plo5')!;
const N = Number(arg('n', '200'));
const START = Number(arg('start', '0'));
const DEPTHS = arg('depths', '100,200,400,800')!.split(',').map(Number);
const POS = arg('pos', 'bb_co')!;
const READ = arg('read', 'none')!;
const OUT = arg('out', '/dev/null')!;
const BASE = arg('opts') ? JSON.parse(readFileSync(arg('opts')!, 'utf8')).opts : {};
const EXTRA = arg('extra') ? JSON.parse(arg('extra')!) : {};
const OPTS = { ...BASE, ...EXTRA, telemetry: true, observeMind: false };
const NC = VARIANT === 'plo4' ? 4 : VARIANT === 'plo5' ? 5 : 2;
const OMAHA = VARIANT !== 'nlh';
const OPENER_ID = '00000000-0000-4000-8000-000000000006';
const FIXED_NOW = 1795501563479;
(perf as unknown as { now: () => number }).now = () => 0;
(globalThis.performance as unknown as { now: () => number }).now = () => 0;
Date.now = () => FIXED_NOW;
enableBrainTelemetry();
const hy = HORSE_HYBRID_PROFILES.cash;

/** Durable rows for the opener read (public counters only, a neutral id). */
function profileRows(): unknown[] {
  if (READ === 'none') return [];
  if (READ === 'profile') {
    const rows = JSON.parse(readFileSync(arg('profile')!, 'utf8')) as Record<string, unknown>[];
    return rows
      .filter(
        (r) =>
          r.variant === VARIANT &&
          r.mode === 'cash' &&
          (r.public_memory_domain as { speed?: string })?.speed === 'table'
      )
      .map((r) => {
        const o: Record<string, unknown> = { ...r, user_id: OPENER_ID };
        delete o.updated_at;
        delete o.legacy_hands;
        return o;
      });
  }
  const H = 44;
  const shape =
    READ === 'wide'
      ? { pfr: 0.6, rfi: 0.62, vpip: 0.72, threeBet: 0.3, foldTo3Bet: 0.0, foldToBet: 0.3, betCheckedTo: 0.5 }
      : { pfr: 0.12, rfi: 0.14, vpip: 0.18, threeBet: 0.04, foldTo3Bet: 0.7, foldToBet: 0.55, betCheckedTo: 0.35 };
  const opp = { rfiOpp: 30, threeBetOpp: 24, foldTo3BetOpp: 12, betCheckedToOpp: 40, foldToBetOpp: 30, riverCallOpp: 8 };
  const c: Record<string, number> = {
    hands: H,
    vpip: shape.vpip * H,
    pfr: shape.pfr * H,
    rfiOpp: opp.rfiOpp,
    rfi: shape.rfi * opp.rfiOpp,
    threeBetOpp: opp.threeBetOpp,
    threeBet: shape.threeBet * opp.threeBetOpp,
    foldTo3BetOpp: opp.foldTo3BetOpp,
    foldTo3Bet: shape.foldTo3Bet * opp.foldTo3BetOpp,
    betCheckedToOpp: opp.betCheckedToOpp,
    betCheckedTo: shape.betCheckedTo * opp.betCheckedToOpp,
    foldToBetOpp: opp.foldToBetOpp,
    foldToBet: shape.foldToBet * opp.foldToBetOpp,
    riverCallOpp: opp.riverCallOpp,
    riverCall: 0.5 * opp.riverCallOpp,
  };
  for (const [long, fast] of Object.entries({
    hands: 'fHands', pfr: 'fPfr', rfiOpp: 'fRfiOpp', rfi: 'fRfi', threeBetOpp: 'fThreeBetOpp', threeBet: 'fThreeBet',
    betCheckedToOpp: 'fBetCheckedToOpp', betCheckedTo: 'fBetCheckedTo', foldToBetOpp: 'fFoldToBetOpp',
    foldToBet: 'fFoldToBet', riverCallOpp: 'fRiverCallOpp', riverCall: 'fRiverCall',
  }))
    c[fast] = c[long]! * 0.3;
  return ['full', 'short'].map((size) => ({
    user_id: OPENER_ID,
    variant: VARIANT,
    mode: 'cash',
    size,
    counters: c,
    observed_hands: 400,
    initialized: true,
    public_memory_domain: { ante: OMAHA ? 'big_blind' : 'none', speed: 'table', version: 1 },
  }));
}
const PROFILE = profileRows();

const SU = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RK = '23456789TJQKA';
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deal(i: number) {
  const r = rng(0x5eed0000 + i);
  const d: { rank: string; suit: string }[] = [];
  for (const s of SU) for (const k of RK) d.push({ rank: k, suit: s });
  for (let j = d.length - 1; j > 0; j--) {
    const x = Math.floor(r() * (j + 1));
    [d[j], d[x]] = [d[x]!, d[j]!];
  }
  return d.slice(0, NC);
}
const str = (c: { rank: string; suit: string }[]) => c.map((x) => x.rank + x.suit[0]).join('');
const DED = {
  bbj: { feeBB: 0.25, enabled: true, minPotBB: 10, minPlayersDealt: 3 },
  rake: { cap: 5, percent: 10, noFlopNoDrop: true, playerCountCaps: [[2, 2.5], [3, 5], [4, 5]] },
  rules: 'controller-rake-bbj-v1',
  status: 'captured',
  version: 1,
};
const ANTE = OMAHA ? 2 : 0;
function pn(seats: number[][], actor: number, o: Record<string, unknown>) {
  return {
    ante: ANTE,
    mode: 'cash',
    asset: 'chips',
    seats,
    boards: [''],
    status: 'captured',
    street: 'preflop',
    bombPot: false,
    variant: VARIANT,
    version: 1,
    anteType: OMAHA ? 'big_blind' : 'none',
    bigBlind: 2,
    chipUnit: 0.01,
    actorSeat: actor,
    structure: OMAHA ? 'pot_limit' : 'no_limit',
    vpipFloor: 40,
    boardCount: 1,
    dealerSeat: 1,
    deductions: DED,
    smallBlind: 1,
    allInOrFold: false,
    fixedBetSize: null,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    wagersCapped: false,
    tournamentStage: { status: 'not_applicable', version: 1 },
    vpipWindowHands: 30,
    ...o,
  };
}
const POSITIONS: Record<string, { hero: number; opener: number }> = {
  bb_co: { hero: 3, opener: 6 },
  bb_btn: { hero: 3, opener: 1 },
  sb_btn: { hero: 2, opener: 1 },
  bb_utg: { hero: 3, opener: 4 },
};
const OTHER_STACK: Record<number, number> = { 1: 872.4, 2: 399, 3: 640, 4: 614.17, 5: 493.5, 6: 700 };
const OPEN_TO = OMAHA ? 9 : 5;
const PREFLOP_ORDER = [4, 5, 6, 1, 2, 3];

/** The hand up to the Horse's node, and (with threeTo) on to its 4-bet node. */
function build(D: number, hole: unknown[], threeTo: number | null) {
  const { hero, opener } = POSITIONS[POS]!;
  const S = 2 * D;
  const stack0: Record<number, number> = { ...OTHER_STACK, [hero]: S, [opener]: S };
  const bet: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 0, 5: 0, 6: 0 };
  const inv: Record<number, number> = { 1: 0, 2: 1, 3: 2 + ANTE, 4: 0, 5: 0, 6: 0 };
  const dead: Record<number, number> = { 1: 0, 2: 0, 3: ANTE, 4: 0, 5: 0, 6: 0 };
  const folded = new Set<number>();
  const allIn = new Set<number>();
  const stack: Record<number, number> = {};
  for (const s of [1, 2, 3, 4, 5, 6]) stack[s] = stack0[s]! - inv[s]!;
  let pot = 1 + 2 + ANTE;
  const tuple = () =>
    [1, 2, 3, 4, 5, 6].map((s) => [s, Math.round(stack[s]! * 100) / 100, bet[s]!, inv[s]!, dead[s]!, 0, folded.has(s) ? 1 : allIn.has(s) ? 2 : 0]);
  const acts: Record<string, unknown>[] = [
    { ord: 0, seat: 2, stage: 'preflop', action: 'sb', amount: 1, origin: 'forced' },
    { ord: 1, seat: 3, stage: 'preflop', action: 'bb', amount: 2, origin: 'forced' },
  ];
  if (ANTE) acts.push({ ord: 2, seat: 3, stage: 'preflop', action: 'ante', amount: ANTE, origin: 'forced', dead: true });
  const push = (a: Record<string, unknown>) => acts.push({ ord: acts.length, stage: 'preflop', ...a });
  const order = [...PREFLOP_ORDER];
  let heroNode = -1;
  for (const s of order) {
    if (s === opener) {
      bet[s] = OPEN_TO; inv[s] = OPEN_TO; stack[s] = stack0[s]! - OPEN_TO; pot += OPEN_TO;
      push({ seat: s, action: 'raise', amount: OPEN_TO, origin: 'player', isFullRaise: true });
      continue;
    }
    if (s === hero) {
      // the opener is on the button for sb_btn: the big blind acts after the hero
      heroNode = acts.length;
      const heroBet = bet[hero]!;
      const toCall = OPEN_TO - heroBet;
      push({
        seat: hero, action: 'fold', amount: 0, origin: 'horse_policy',
        publicNode: pn(tuple(), hero, {
          pot, toCall, currentBet: OPEN_TO, minRaiseTo: OPEN_TO + (OPEN_TO - 2),
          maxRaiseTo: OMAHA ? OPEN_TO + pot + toCall : heroBet + stack[hero]!,
        }),
      });
      break;
    }
    if (!acts.some((a) => a.seat === opener && a.action === 'raise') && PREFLOP_ORDER.indexOf(s) > PREFLOP_ORDER.indexOf(opener)) continue;
    folded.add(s);
    push({ seat: s, action: 'fold', amount: 0, origin: 'horse_policy' });
  }
  // seats between the opener and the hero in order that are not yet folded fold (handled above); others after the hero
  let fourNode = -1;
  let toCall4 = 0;
  if (threeTo !== null) {
    const heroBet = bet[hero]!;
    (acts[heroNode] as Record<string, unknown>).action = 'raise';
    (acts[heroNode] as Record<string, unknown>).amount = threeTo;
    (acts[heroNode] as Record<string, unknown>).isFullRaise = true;
    const heroIn = threeTo - heroBet;
    stack[hero] = stack[hero]! - heroIn; inv[hero] = inv[hero]! + heroIn; bet[hero] = threeTo; pot += heroIn;
    // players after the hero who have not acted fold to the 3-bet
    for (const s of PREFLOP_ORDER.slice(PREFLOP_ORDER.indexOf(hero) + 1)) {
      if (s === opener || folded.has(s)) continue;
      folded.add(s);
      push({ seat: s, action: 'fold', amount: 0, origin: 'horse_policy' });
    }
    const openerAll = OPEN_TO + stack[opener]!;
    const want = OMAHA ? threeTo + (pot + (threeTo - OPEN_TO)) : Math.round(threeTo * 2.3 * 100) / 100;
    const fourTo = Math.min(openerAll, want);
    const oIn = fourTo - bet[opener]!;
    stack[opener] = stack[opener]! - oIn; inv[opener] = inv[opener]! + oIn; bet[opener] = fourTo; pot += oIn;
    const oAll = stack[opener]! <= 0.005;
    if (oAll) allIn.add(opener);
    push({ seat: opener, action: oAll ? 'all_in' : 'raise', amount: fourTo, origin: 'player', isFullRaise: true });
    toCall4 = Math.min(fourTo - threeTo, stack[hero]!);
    const heroMax = threeTo + stack[hero]!;
    fourNode = acts.length;
    push({
      seat: hero, action: 'fold', amount: 0, origin: 'horse_policy',
      publicNode: pn(tuple(), hero, {
        pot, toCall: toCall4, currentBet: fourTo,
        minRaiseTo: oAll ? null : Math.min(heroMax, fourTo + (fourTo - threeTo)),
        maxRaiseTo: oAll ? null : Math.min(heroMax, OMAHA ? fourTo + pot + (fourTo - threeTo) : heroMax),
        legalActions: oAll ? ['fold', 'call', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
      }),
    });
  }
  const h = {
    handId: 'a6f9206d-3a5e-4a7f-8c7c-65c67fcb2778', variant: VARIANT, bigBlind: 2, smallBlind: 1, buttonSeat: 1,
    publicMemoryDomain: { version: 1, speed: 'table', ante: OMAHA ? 'big_blind' : 'none' },
    players: [1, 2, 3, 4, 5, 6].map((s) => ({ seat: s, userId: 'u' + s, isHorse: s !== opener })),
    horseHoleCards: { ['u' + hero]: hole }, actions: acts,
  };
  return { h, heroNode, fourNode, toCall4 };
}

function run(h: Record<string, unknown>, ord: number, seed: number) {
  const { opener } = POSITIONS[POS]!;
  const node = (h.actions as unknown[])[ord];
  const st = stateAt(h as never, node as never) as { gs: Record<string, unknown>; hero: unknown; pn: unknown };
  const g = st.gs as { players: { user_id: string; username: string }[]; humanUserIds?: string[]; actionHistory: { userId: string }[] };
  const P = 'p' + opener;
  for (const p of g.players) if (p.user_id === P) { p.user_id = OPENER_ID; p.username = OPENER_ID; }
  if (g.humanUserIds) g.humanUserIds = g.humanUserIds.map((x) => (x === P ? OPENER_ID : x));
  for (const a of g.actionHistory) if (a.userId === P) a.userId = OPENER_ID;
  HorseMind.reset();
  if (PROFILE.length) HorseMind.importDurableOpponentProfiles(PROFILE as never);
  seedFastRandom(seed);
  seedHorseBetSizeRandom(seed ^ 0x5bd1e995);
  seedHorseTimingRandom(seed ^ 0x9e3779b9);
  drainFires();
  const d = HorseLogic.decide(st.hero as never, JSON.parse(JSON.stringify(st.gs)), hy.style, { ...hy.mods }, { ...OPTS, decisionTimeMs: FIXED_NOW } as never) as Record<string, unknown>;
  const k = actionKind(d.action as never, d.amount as never, st.pn as never);
  const fires = drainFires().map((f) => f.feature).filter((f) => /oop_reraise|v53|reraise_by_position|oop_reraised|priced_fold|three_bet/.test(f));
  return { k, amt: d.amount as number | undefined, fires, receipt: d.oopReraiseRangeHolds as Record<string, unknown> | undefined };
}

if (START === 0 || !arg('append')) writeFileSync(OUT, '');
let decisions = 0;
const t0 = Date.now();
const wall = process.hrtime.bigint();
for (let i = START; i < START + N; i++) {
  const hole = deal(i);
  const cls = OMAHA ? omahaHandClass(hole as never) : holdemClassOf(hole[0] as never, hole[1] as never);
  for (const D of DEPTHS) {
    const b = build(D, hole, null);
    const a = run(b.h, b.heroNode, 1000 + i);
    decisions++;
    const row: Record<string, unknown> = { i, D, pos: POS, read: READ, hole: str(hole), cls, tb: a.k, tbAmt: a.amt, tbFires: a.fires };
    if (a.receipt) {
      const r = a.receipt as Record<string, unknown>;
      row.rc = { verdict: r.verdict, reason: r.reason, fourBetAnswer: r.fourBetAnswer, keep: r.keep, ev: r.ev, answers: r.answers, callAdmitted: r.callAdmitted, blocker: r.blocker, effBB: r.effBB };
    }
    if ((a.k === 'raise' || a.k === 'jam') && Number.isFinite(a.amt)) {
      const b4 = build(D, hole, a.amt as number);
      const f = run(b4.h, b4.fourNode, 5000 + i);
      decisions++;
      Object.assign(row, { f4: f.k, f4Amt: f.amt });
    } else if (a.k === 'jam') {
      Object.assign(row, { f4: 'allin' });
    }
    appendFileSync(OUT, JSON.stringify(row) + '\n');
  }
}
const ms = Number(process.hrtime.bigint() - wall) / 1e6;
console.log(JSON.stringify({ done: N, decisions, ms, msPerDecision: ms / decisions, t0 }));
