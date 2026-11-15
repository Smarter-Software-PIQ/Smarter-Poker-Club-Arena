/**
 * OMAHA: THREE BETS THAT BECOME CHECKS (owner 2026-11-15, hand 59517323;
 * options omahaBareOverpairOopFlopCheck, omahaOverpairNoOopBarrelVsValueLeader
 * and omahaPairedRiverNoThinLeadVsValueLeader, each default OFF).
 *
 * The recorded hand, anonymised to seat numbers (the fixture beside the
 * complaint laws): a Horse out of position with aces bets the 5-8-9 two-tone
 * flop, the turn after the call, and the river that pairs the board, into the
 * one player who called both streets.
 *
 *  - each option: unset, false and a truthy non-boolean decide
 *    byte-identically; on, the recorded bet becomes a check at every seed for
 *    every profile; the rule draws nothing from the brain's random stream;
 *    the check is admitted by the worker receipt validator;
 *  - the turn and river options: an unknown or presumed opponent, and a
 *    measured one who is not a value leader, get today's decision, with the
 *    withheld receipt; the mind off, today's decision;
 *  - the boundaries: in position, a set, two pair, a full house, a flush draw
 *    or a wrap (flop), an unpaired river: today's decision;
 *  - facing a bet nothing changes on the turn and the river, and after the
 *    check the hand continues against a bet at the prices pinned below;
 *  - THE CONTINUATION of omahaBareOverpairOopFlopCheck (heads-up, the flop,
 *    facing the bet after the check): nine hand classes in PLO4 and PLO5,
 *    four bet sizes, three reads, every seed: never a raise; one action per
 *    cell; calls fall as the price rises and as the read goes from a
 *    measured over-bettor to unknown to a measured value leader; unset,
 *    false and truthy non-boolean decide byte-identically; the receipts; the
 *    validator; multiway, the whole-stack call and other hands keep today's
 *    decision.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, omahaDrawQuality, saveFastRandom, seedFastRandom } from './HorseEval.js';
import { realizationFactor } from './GtoFacingDefenseV32.js';
import {
  HorseLogic,
  omahaBareOverpairFlopFacingBetRule,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  OMAHA_BARE_OVERPAIR_CONT_REALIZATION,
  omahaBareOverpairContAdmitsCall,
  omahaBareOverpairContLean,
  omahaBareOverpairFlopFacingBetSpot,
  omahaBareOverpairFlopFacingBetVerdict,
  omahaBareBigPairOnFlop,
  omahaBareOverpairOopFlopSpot,
  omahaHeroHasPreflopLead,
  omahaOverpairOopTurnBarrelSpot,
  omahaPairedRiverThinLeadSpot,
  type OmahaBareOverpairContRead,
} from './HorseOmahaOopChecks.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  actionKind,
  recordedPathMatches,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ReplayProfile,
} from './HorseComplaintReplay.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import FIXTURE from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

const FLOP = 14;
const TURN = 16;
const RIVER = 18;
const HERO = 5;
const CALLER = 1;
const PROFILES = replayProfiles('cash');
const LIVE = PROFILES.find((p) => p.live)!;
const SEEDS = [...FX.seeds, 101, 102, 103, 104, 105, 106];

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Edit {
  /** hero's hole cards instead of the recorded ones */
  hole?: string;
  /** the board at the node instead of the recorded one */
  board?: string;
  /** hero in position: the button moves so the caller acts first and checks to hero */
  inPosition?: boolean;
}
type Node = ReturnType<typeof stateAt>;
const clone = (): ComplaintFixture => JSON.parse(JSON.stringify(FX)) as ComplaintFixture;

/** The recorded decision node `ord`, optionally edited. */
function nodeAt(ord: number, edit: Edit = {}): Node {
  const f = clone();
  if (edit.hole) f.hole[String(HERO)] = cards(edit.hole);
  const node = f.actions.find((a) => a.ord === ord)!;
  if (edit.board) node.publicNode!.boards = [edit.board];
  if (edit.inPosition) {
    node.publicNode!.dealerSeat = 6;
    const out: ComplaintAction[] = [];
    let n = 0;
    const push = (a: Partial<ComplaintAction>) => out.push({ ...a, ord: ++n } as ComplaintAction);
    const check = (stage: string) =>
      push({ seat: CALLER, stage, action: 'check', amount: 0, origin: 'player' });
    let street = 'preflop';
    for (const a of f.actions.filter((x) => x.ord < ord)) {
      if (a.stage !== street) {
        street = a.stage;
        check(street);
      }
      push(a);
    }
    if (node.stage !== street) check(node.stage);
    node.ord = n + 1;
    f.actions = [...out, node];
  }
  return stateAt(f, node);
}

/** Hero checked the recorded node `ord` and the caller bet `x` (all in when `allIn`). */
function facingAfterCheck(ord: number, x: number, allIn = false): Node {
  const f = clone();
  const node = f.actions.find((a) => a.ord === ord)!;
  const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
    ComplaintAction['publicNode']
  >;
  f.actions = f.actions.filter((a) => a.ord < ord);
  f.actions.push({
    ord,
    seat: HERO,
    stage: node.stage,
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
  });
  f.actions.push({
    ord: ord + 1,
    seat: CALLER,
    stage: node.stage,
    action: allIn ? 'all_in' : 'bet',
    amount: x,
    origin: 'player',
    isFullRaise: true,
  });
  const row = pn.seats.find((s) => s[0] === CALLER)!;
  row[1] = Math.round((row[1] - x) * 100) / 100;
  row[2] = x;
  row[3] += x;
  if (allIn) row[6] = 2;
  const pot = pn.pot;
  pn.pot = pot + x;
  pn.toCall = x;
  pn.currentBet = x;
  pn.minRaiseTo = allIn ? null : 2 * x;
  pn.maxRaiseTo = allIn ? null : pot + 3 * x;
  pn.legalActions = allIn ? ['fold', 'call'] : ['fold', 'call', 'raise', 'all_in'];
  const next: ComplaintAction = {
    ord: ord + 2,
    seat: HERO,
    stage: node.stage,
    action: 'call',
    amount: x,
    origin: 'horse_policy',
    publicNode: pn,
  };
  f.actions.push(next);
  return stateAt(f, next);
}

const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
type Reads = (userId: string) => OmahaReadConditional | null;
function play(
  build: () => Node,
  opts: HorseDecideOpts,
  reads?: Reads,
  profile: ReplayProfile = LIVE
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    // mind on: the value-leader read is consulted only with the opponent memory present
    const d = HorseLogic.decide(st.hero, st.gs, profile.style, profile.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;
const notLeader = {
  measured: true,
  tightReRaiser: false,
  valueLeader: false,
} as OmahaReadConditional;
/** A presumed read: a row exists, nothing measured (HorseOmahaReadConditional). */
const presumed = {
  measured: false,
  tightReRaiser: false,
  valueLeader: false,
} as OmahaReadConditional;
const WAGERS = ['bet', 'raise', 'all_in'];
const wagers = (o: Outcome) => o.actions.filter((a) => WAGERS.includes(a)).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

const RIVER_ON: HorseDecideOpts = { omahaPairedRiverNoThinLeadVsValueLeader: true };
const TURN_ON: HorseDecideOpts = { omahaOverpairNoOopBarrelVsValueLeader: true };
const FLOP_ON: HorseDecideOpts = { omahaBareOverpairOopFlopCheck: true };
const ALL_ON: HorseDecideOpts = { ...RIVER_ON, ...TURN_ON, ...FLOP_ON };

const OPTIONS = [
  {
    name: 'omahaPairedRiverNoThinLeadVsValueLeader',
    on: RIVER_ON,
    ord: RIVER,
    receipt: 'omaha_paired_river_thin_lead',
    readGated: true,
  },
  {
    name: 'omahaOverpairNoOopBarrelVsValueLeader',
    on: TURN_ON,
    ord: TURN,
    receipt: 'omaha_overpair_oop_turn_barrel',
    readGated: true,
  },
  {
    name: 'omahaBareOverpairOopFlopCheck',
    on: FLOP_ON,
    ord: FLOP,
    receipt: 'omaha_bare_overpair_oop_flop',
    readGated: false,
  },
] as const;

describe('hand 59517323, the recorded hand', () => {
  it('the fixture is the recorded hand and it bet the turn and the river', () => {
    expect(FX.handId).toBe('b84739da-6e6f-4627-97ee-564f18cc81d5');
    expect(recordedPathMatches(FX)).toBe(true);
    for (const ord of [FLOP, TURN, RIVER]) {
      const a = FX.actions.find((x) => x.ord === ord)!;
      expect(actionKind(a.action, a.amount, a.publicNode!)).toBe('raise');
    }
    expect(FX.players.every((p) => Object.keys(p).sort().join() === 'isHorse,seat')).toBe(true);
    expect(JSON.stringify(FX)).not.toMatch(/userId|username/);
  });

  it('the three public spots hold at the recorded flop, turn and river', () => {
    const flop = nodeAt(FLOP);
    const turn = nodeAt(TURN);
    const river = nodeAt(RIVER);
    expect(omahaBareOverpairOopFlopSpot(flop.hero, flop.gs)).toBe(true);
    expect(omahaOverpairOopTurnBarrelSpot(turn.hero, turn.gs)).toBe(true);
    expect(omahaPairedRiverThinLeadSpot(river.hero, river.gs)).toBe(true);
    // each spot is its own street's
    expect(omahaBareOverpairOopFlopSpot(turn.hero, turn.gs)).toBe(false);
    expect(omahaOverpairOopTurnBarrelSpot(river.hero, river.gs)).toBe(false);
    expect(omahaPairedRiverThinLeadSpot(turn.hero, turn.gs)).toBe(false);
    // the turn hand holds the nut flush draw: it does not exempt the turn check
    expect(
      omahaDrawQuality(turn.hero.cards, turn.gs.communityCards ?? [], false).nutFlushDraw
    ).toBe(true);
  });

  it("today's brain bets each street at some seed (the spots are live)", () => {
    for (const ord of [FLOP, TURN, RIVER])
      expect(
        wagers(
          play(
            () => nodeAt(ord),
            {},
            () => null
          )
        )
      ).toBeGreaterThan(0);
  });
});

describe.each(OPTIONS)('$name', (o) => {
  const build = () => nodeAt(o.ord);

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = play(build, {}, () => leader);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
      const off = play(build, { [o.name]: v }, () => leader);
      expect(off.bytes).toEqual(unset.bytes);
      expect(off.next).toEqual(unset.next);
    }
    expect(hasFire(unset, `${o.receipt}_checked`)).toBe(0);
  });

  it('on, against a measured value leader: the recorded bet is a check at every seed, for every profile', () => {
    for (const p of PROFILES) {
      const off = play(build, {}, () => leader, p);
      const on = play(build, o.on, () => leader, p);
      expect(wagers(on)).toBe(0);
      expect(hasFire(on, `${o.receipt}_checked`)).toBe(wagers(off));
      on.actions.forEach((a, i) => {
        if (WAGERS.includes(off.actions[i])) expect(a).toBe('check');
        else expect(on.bytes[i]).toEqual(off.bytes[i]);
      });
      // the rule draws nothing from the brain's random stream
      expect(on.next).toEqual(off.next);
    }
  });

  it.skipIf(!o.readGated)(
    'on, against an unknown, presumed or measured non-leader opponent: today’s decision, withheld',
    () => {
      const off = play(build, {});
      for (const reads of [() => null, () => presumed, () => notLeader]) {
        const on = play(build, o.on, reads as Reads);
        expect(on.bytes).toEqual(off.bytes);
        expect(on.next).toEqual(off.next);
        expect(hasFire(on, `${o.receipt}_withheld`)).toBe(wagers(off));
        expect(hasFire(on, `${o.receipt}_checked`)).toBe(0);
      }
      // the mind off: no read is consulted, today's decision
      expect(play(build, { ...o.on, mind: false }, () => leader).bytes).toEqual(
        play(build, { mind: false }).bytes
      );
    }
  );

  it.skipIf(o.readGated)('on: no opponent read is needed (unknown, presumed, the mind off)', () => {
    for (const [reads, extra] of [
      [() => null, {}],
      [() => presumed, {}],
      [() => leader, { mind: false }],
    ] as const) {
      const off = play(build, extra, reads as Reads);
      const on = play(build, { ...o.on, ...extra }, reads as Reads);
      expect(wagers(off)).toBeGreaterThan(0);
      expect(wagers(on)).toBe(0);
      expect(hasFire(on, `${o.receipt}_checked`)).toBe(wagers(off));
    }
  });

  it('the check is admitted by the worker receipt validator', () => {
    let checked = 0;
    for (const s of SEEDS) {
      HorseMind.reset();
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
      seedFastRandom(s);
      const st = build();
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, o.on));
      vi.restoreAllMocks();
      expect(d.action).toBe('check');
      const changed = d.policyGraph?.transitions.some((t) => t.node === 'wager_rules' && t.changed);
      if (changed) checked++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('boundaries: today’s decision', () => {
  const same = (build: () => Node, on: HorseDecideOpts, wantsBet = true) => {
    const off = play(build, {}, () => leader);
    const got = play(build, on, () => leader);
    expect(got.bytes).toEqual(off.bytes);
    if (wantsBet) expect(wagers(off)).toBeGreaterThan(0);
  };

  it('river: a full house still bets; an unpaired river is unchanged', () => {
    // nines full of fives
    const boat = () => nodeAt(RIVER, { hole: 'As9s9c7c4h' });
    expect(omahaPairedRiverThinLeadSpot(boat().hero, boat().gs)).toBe(false);
    same(boat, ALL_ON);
    const brick = () => nodeAt(RIVER, { board: '5d8d9h2hKc' });
    expect(omahaPairedRiverThinLeadSpot(brick().hero, brick().gs)).toBe(false);
    same(brick, ALL_ON, false);
  });

  it('river: a board paired on the turn counts, and trips or a straight below a full house check too', () => {
    const pairedTurn = nodeAt(RIVER, { board: '5d8d9h5hKc' });
    expect(omahaPairedRiverThinLeadSpot(pairedTurn.hero, pairedTurn.gs)).toBe(true);
    const trips = nodeAt(RIVER, { hole: 'AsKh5sQc4h' });
    expect(omahaPairedRiverThinLeadSpot(trips.hero, trips.gs)).toBe(true);
    const straight = nodeAt(RIVER, { hole: 'AsAh7s6c4h' });
    expect(omahaPairedRiverThinLeadSpot(straight.hero, straight.gs)).toBe(true);
  });

  it('river: a caller who has folded, or a hand whose bets were never called, is not the spot', () => {
    const st = nodeAt(RIVER);
    const noCall = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).map((a) =>
        a.seat === CALLER && a.stage !== 'preflop' ? { ...a, action: 'check', amount: 0 } : a
      ),
    };
    expect(omahaPairedRiverThinLeadSpot(st.hero, noCall as never)).toBe(false);
    // the caller raised hero's turn bet and hero called: hero was not the last aggressor
    const raised = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).map((a) =>
        a.seat === CALLER && a.stage !== 'preflop' ? { ...a, action: 'raise' } : a
      ),
    };
    expect(omahaPairedRiverThinLeadSpot(st.hero, raised as never)).toBe(false);
  });

  it('turn: in position, a set and two pair still bet as today', () => {
    const ip = () => nodeAt(TURN, { inPosition: true });
    expect(omahaOverpairOopTurnBarrelSpot(ip().hero, ip().gs)).toBe(false);
    same(ip, ALL_ON);
    for (const hole of ['As9s9c7c4h', 'As9s8c7c4h']) {
      const made = () => nodeAt(TURN, { hole });
      expect(omahaOverpairOopTurnBarrelSpot(made().hero, made().gs)).toBe(false);
      same(made, ALL_ON);
    }
  });

  it('turn: a board with no straight possible, or a flop bet that was not called, is not the spot', () => {
    const dry = nodeAt(TURN, { board: '2d7dKh2h' });
    expect(omahaOverpairOopTurnBarrelSpot(dry.hero, dry.gs)).toBe(false);
    const st = nodeAt(TURN);
    const checkedFlop = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).filter((a) => a.stage !== 'flop'),
    };
    expect(omahaOverpairOopTurnBarrelSpot(st.hero, checkedFlop as never)).toBe(false);
    // three-handed: the turn rule is heads-up only
    const three = {
      ...st.gs,
      players: st.gs.players.map((p) => (p.seat === 6 ? { ...p, is_folded: false } : p)),
    };
    expect(omahaOverpairOopTurnBarrelSpot(st.hero, three as never)).toBe(false);
  });

  it('flop: in position, a set, two pair, a flush draw and a wrap still bet as today', () => {
    const ip = () => nodeAt(FLOP, { inPosition: true });
    expect(omahaBareOverpairOopFlopSpot(ip().hero, ip().gs)).toBe(false);
    same(ip, ALL_ON);
    for (const hole of [
      'As9s9c7c4h', // a set
      'As9s8c7c4h', // top two pair
      'AsAdQs7c4d', // aces with the nut flush draw
      'AsAhJcTc7s', // aces with a wrap (Q, 7 and 6 make a straight)
    ]) {
      const made = () => nodeAt(FLOP, { hole });
      expect(omahaBareOverpairOopFlopSpot(made().hero, made().gs)).toBe(false);
      same(made, ALL_ON, false);
    }
  });

  it('flop: any texture is the spot, a dry rainbow flop included; a multiway pot is', () => {
    const dry = nodeAt(FLOP, { board: '2dKh7s' });
    expect(omahaBareOverpairOopFlopSpot(dry.hero, dry.gs)).toBe(true);
    const st = nodeAt(FLOP);
    const three = {
      ...st.gs,
      players: st.gs.players.map((p) => (p.seat === 6 ? { ...p, is_folded: false } : p)),
    };
    expect(omahaBareOverpairOopFlopSpot(st.hero, three as never)).toBe(true);
  });

  it('outside PLO4/PLO5 cash, in Hi-Lo, on two boards or facing a bet no spot holds', () => {
    for (const ord of [FLOP, TURN, RIVER]) {
      const st = nodeAt(ord);
      const spot =
        ord === FLOP
          ? omahaBareOverpairOopFlopSpot
          : ord === TURN
            ? omahaOverpairOopTurnBarrelSpot
            : omahaPairedRiverThinLeadSpot;
      expect(spot(st.hero, st.gs)).toBe(true);
      for (const over of [
        { gameVariant: 'plo6' },
        { gameVariant: 'plo8' },
        { gameMode: 'tournament' },
        { variantRules: { splitLow8OrBetter: true } },
        { communityCards2: st.gs.communityCards },
        { toCall: 40, currentBet: 40 },
        { legalActions: ['fold', 'bet', 'all_in'] },
        { allInOrFold: true },
      ])
        expect(spot(st.hero, { ...st.gs, ...over } as never)).toBe(false);
    }
  });
});

describe('facing a bet nothing changes, and the checked hand continues', () => {
  const PRICES = [0.33, 0.5, 0.75, 1];

  it('no option changes a decision facing a bet on the turn or the river; on the flop only the bare-pair option does', () => {
    for (const frac of PRICES) {
      const turn = () => facingAfterCheck(TURN, Math.round(555 * frac));
      expect(play(turn, ALL_ON, () => leader).bytes).toEqual(play(turn, {}, () => leader).bytes);
      const flop = () => facingAfterCheck(FLOP, Math.round(357 * frac));
      expect(play(flop, { ...RIVER_ON, ...TURN_ON }, () => leader).bytes).toEqual(
        play(flop, {}, () => leader).bytes
      );
    }
    const shove = () => facingAfterCheck(RIVER, 417.9, true);
    expect(play(shove, ALL_ON, () => leader).bytes).toEqual(play(shove, {}, () => leader).bytes);
  });

  it('turn: after the check, the overpair with the nut flush draw never folds to a bet of a third of the pot up to the pot', () => {
    for (const frac of PRICES)
      for (const reads of [() => null, () => leader]) {
        const o = play(
          () => facingAfterCheck(TURN, Math.round(555 * frac)),
          ALL_ON,
          reads as Reads
        );
        expect(o.actions.filter((a) => a === 'fold')).toEqual([]);
      }
  });

  it('flop: after the check, the bare overpair never folds to a bet of a third of the pot', () => {
    for (const reads of [() => null, () => leader]) {
      const o = play(() => facingAfterCheck(FLOP, Math.round(357 * 0.33)), ALL_ON, reads as Reads);
      expect(o.actions.filter((a) => a === 'fold')).toEqual([]);
    }
  });

  it('river: after the check, aces up fold to the all-in of 417.9 into 1,021 (they no longer pay it off)', () => {
    const o = play(
      () => facingAfterCheck(RIVER, 417.9, true),
      ALL_ON,
      () => leader
    );
    expect(new Set(o.actions)).toEqual(new Set(['fold']));
  });
});

describe('in the league (anonymised seats, memory learning on)', () => {
  it('off by default: unset and false play the same poker', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `oop_checks_off_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: {},
          b: {
            omahaPairedRiverNoThinLeadVsValueLeader: false,
            omahaOverpairNoOopBarrelVsValueLeader: false,
            omahaBareOverpairOopFlopCheck: false,
          },
        },
        60,
        4530001
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 300_000);

  it('on, with the memory learning: no illegal action and no fallback', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `oop_checks_on_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: { ...ALL_ON },
          b: {},
        },
        60,
        4540001
      );
      expect(r.illegalActions).toBe(0);
      expect(r.brainExceptionFallbacks ?? 0).toBe(0);
    }
  }, 300_000);
});

describe('omahaBareOverpairOopFlopCheck, the continuation: facing the flop bet after the check', () => {
  interface Cls {
    name: string;
    hole: string;
    board: string;
  }
  /** One pair, backdoor draws at most, on a two-tone or connected flop: PLO5 and PLO4. */
  const CLASSES: Cls[] = [
    { name: 'plo5 aces, 5-8-9 two-tone (the recorded hand)', hole: 'AsAhQs7c4h', board: '5d8d9h' },
    { name: 'plo5 aces, K-7-2 two-tone', hole: 'AsAhQs9c4h', board: 'Kd7d2h' },
    { name: 'plo5 aces, 6-7-8 rainbow', hole: 'AsAhKsQc2d', board: '6c7d8h' },
    { name: 'plo5 aces, Q-J-4 two-tone', hole: 'AsAh9s6c2c', board: 'QdJd4h' },
    { name: 'plo5 kings, 9-6-2 two-tone', hole: 'KsKhQs8c3h', board: '9d6d2h' },
    { name: 'plo4 aces, 5-8-9 two-tone', hole: 'AsAhQs7c', board: '5d8d9h' },
    { name: 'plo4 aces, K-7-2 two-tone', hole: 'AsAhQs9c', board: 'Kd7d2h' },
    { name: 'plo4 aces, 6-7-8 rainbow', hole: 'AsAhKsQc', board: '6c7d8h' },
    { name: 'plo4 kings, 9-6-2 two-tone', hole: 'KsKhQs8c', board: '9d6d2h' },
  ];
  const SIZES = [0.33, 0.5, 0.67, 1];
  const POT = 357;
  const stat = (mean: number, engaged: 'high' | 'low' | null) => ({
    mean,
    n: 30,
    engaged,
    excess: engaged ? 0.6 : 0,
  });
  const measured = {
    hands: 80,
    measured: true,
    tightReRaiser: false,
    wideReRaiser: false,
    threeBet: stat(0.1, null),
    foldToBet: stat(0.4, null),
    riverCall: stat(0.4, null),
  };
  /** The memory's read (what HorseLogic asks) and the same read as the verdict takes it. */
  const READS: {
    name: string;
    memory: OmahaReadConditional | null;
    read: OmahaBareOverpairContRead | null;
  }[] = [
    {
      name: 'a measured postflop over-bettor',
      memory: {
        ...measured,
        valueLeader: false,
        postflopAggressor: true,
        betCheckedTo: stat(0.95, 'high'),
      } as OmahaReadConditional,
      read: {
        measured: true,
        valueLeader: false,
        postflopAggressor: true,
        betCheckedToRatio: 2,
      },
    },
    { name: 'unknown', memory: null, read: null },
    {
      name: 'a measured value leader',
      memory: {
        ...measured,
        valueLeader: true,
        postflopAggressor: false,
        betCheckedTo: stat(0.2, 'low'),
      } as OmahaReadConditional,
      read: {
        measured: true,
        valueLeader: true,
        postflopAggressor: false,
        betCheckedToRatio: null,
      },
    },
  ];
  interface Shape {
    /** a third live player (seat 6) */
    threeWay?: boolean;
    /** the Horse's stack, to make the call a whole-stack call */
    heroStack?: number;
  }
  /** The Horse checked the flop and the caller bet `frac` of the pot. */
  function facing(c: Cls, frac: number, shape: Shape = {}): Node {
    const f = clone();
    const plo4 = c.hole.length === 8;
    if (plo4) (f as unknown as { variant: string }).variant = 'plo4';
    f.hole[String(HERO)] = cards(c.hole);
    const node = f.actions.find((a) => a.ord === FLOP)!;
    const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
      ComplaintAction['publicNode']
    >;
    if (plo4) (pn as unknown as { variant: string }).variant = 'plo4';
    pn.boards = [c.board];
    const x = Math.round(POT * frac);
    f.actions = f.actions.filter((a) => a.ord < FLOP);
    f.actions.push({
      ord: FLOP,
      seat: HERO,
      stage: 'flop',
      action: 'check',
      amount: 0,
      origin: 'horse_policy',
    } as ComplaintAction);
    f.actions.push({
      ord: FLOP + 1,
      seat: CALLER,
      stage: 'flop',
      action: 'bet',
      amount: x,
      origin: 'player',
      isFullRaise: true,
    } as ComplaintAction);
    const row = pn.seats.find((r) => r[0] === CALLER)!;
    row[1] = Math.round((row[1] - x) * 100) / 100;
    row[2] = x;
    row[3] += x;
    if (shape.heroStack !== undefined) pn.seats.find((r) => r[0] === HERO)![1] = shape.heroStack;
    if (shape.threeWay) pn.seats.find((r) => r[0] === 6)![6] = 0;
    pn.pot = POT + x;
    pn.toCall = x;
    pn.currentBet = x;
    pn.minRaiseTo = 2 * x;
    pn.maxRaiseTo = POT + 3 * x;
    pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
    const next = {
      ord: FLOP + 2,
      seat: HERO,
      stage: 'flop',
      action: 'call',
      amount: x,
      origin: 'horse_policy',
      publicNode: pn,
    } as ComplaintAction;
    f.actions.push(next);
    return stateAt(f, next);
  }
  /** The verdict's action for a cell, asked of the pure module. */
  function ruled(c: Cls, frac: number, read: OmahaBareOverpairContRead | null): 'call' | 'fold' {
    const st = facing(c, frac);
    const spot = omahaBareOverpairFlopFacingBetSpot(st.hero, st.gs);
    expect(spot, c.name).not.toBeNull();
    const v = omahaBareOverpairFlopFacingBetVerdict(spot!, st.hero, st.gs, read);
    expect(v, c.name).not.toBeNull();
    return v!.call ? 'call' : 'fold';
  }
  const CONT = [
    'omaha_bare_overpair_oop_flop_check_called',
    'omaha_bare_overpair_oop_flop_check_folded',
    'omaha_bare_overpair_oop_flop_check_raise_flatted',
  ];
  const contFires = (o: Outcome) => o.fires.flat().filter((f) => CONT.includes(f)).length;

  it('every class is the spot of the check and of the continuation, in its own game', () => {
    for (const c of CLASSES) {
      const st = facing(c, 0.5);
      expect(String(st.gs.gameVariant), c.name).toBe(c.hole.length === 8 ? 'plo4' : 'plo5');
      expect(st.hero.cards.length, c.name).toBe(c.hole.length / 2);
      const spot = omahaBareOverpairFlopFacingBetSpot(st.hero, st.gs);
      expect(spot, c.name).not.toBeNull();
      expect(spot!.call).toBe(Math.round(POT * 0.5));
      expect(spot!.potFrac).toBeCloseTo(Math.round(POT * 0.5) / POT, 9);
      expect(spot!.price).toBeCloseTo(spot!.call / (POT + 2 * spot!.call), 9);
    }
  });

  it('on: at every seed one action per cell, the verdict of the pure module, and never a raise', () => {
    for (const c of CLASSES)
      for (const frac of SIZES)
        for (const r of READS) {
          const want = ruled(c, frac, r.read);
          const o = play(() => facing(c, frac), FLOP_ON, (() => r.memory) as Reads);
          expect(new Set(o.actions), `${c.name} ${frac} ${r.name}`).toEqual(new Set([want]));
          expect(wagers(o)).toBe(0);
        }
  });

  it('calls fall as the price rises and as the read goes from over-bettor to unknown to value leader', () => {
    let small = 0;
    let big = 0;
    const calls = READS.map(() => 0);
    for (const c of CLASSES) {
      const grid = READS.map((r) => SIZES.map((frac) => ruled(c, frac, r.read) === 'call'));
      // price: once a size is folded, every larger size is folded
      for (const row of grid)
        for (let i = 1; i < row.length; i++) expect(row[i] && !row[i - 1], c.name).toBe(false);
      // read: a call against a stronger range is a call against a weaker one
      for (let i = 0; i < SIZES.length; i++) {
        expect(grid[2][i] && !grid[1][i], c.name).toBe(false);
        expect(grid[1][i] && !grid[0][i], c.name).toBe(false);
      }
      grid.forEach((row, i) => (calls[i] += row.filter(Boolean).length));
      if (grid[0][0]) small++;
      if (grid[2][SIZES.length - 1]) big++;
    }
    // a third of the pot from an over-bettor is called far more than the pot from a value leader
    expect(small).toBeGreaterThanOrEqual(CLASSES.length - 1);
    expect(big).toBe(0);
    expect(calls[0]).toBeGreaterThan(calls[1]);
    expect(calls[1]).toBeGreaterThan(calls[2]);
    // no blanket rule: every read has classes it calls and classes it folds
    for (const n of calls) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(CLASSES.length * SIZES.length);
    }
  });

  it('the same against the brain, every seed: the small bet from the over-bettor is called more than the big bet from the value leader', () => {
    const count = (frac: number, memory: OmahaReadConditional | null) =>
      CLASSES.reduce(
        (n, c) =>
          n +
          play(() => facing(c, frac), FLOP_ON, (() => memory) as Reads).actions.filter(
            (a) => a === 'call'
          ).length,
        0
      );
    const small = count(0.33, READS[0].memory);
    const mid = count(0.67, READS[1].memory);
    const big = count(1, READS[2].memory);
    expect(small).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(big);
    expect(big).toBe(0);
  });

  it('the read is a lean: unknown and unmeasured none, a value leader the full value lean, an over-bettor an aggressive one', () => {
    expect(omahaBareOverpairContLean(null)).toBe(0);
    expect(
      omahaBareOverpairContLean({
        measured: false,
        valueLeader: true,
        postflopAggressor: true,
        betCheckedToRatio: 2,
      })
    ).toBe(0);
    expect(omahaBareOverpairContLean(READS[2].read)).toBe(-1);
    expect(omahaBareOverpairContLean(READS[0].read)).toBe(1);
    expect(omahaBareOverpairContLean({ ...READS[0].read!, betCheckedToRatio: null })).toBeCloseTo(
      0.6,
      9
    );
    expect(
      omahaBareOverpairContLean({
        measured: true,
        valueLeader: false,
        postflopAggressor: false,
        betCheckedToRatio: 1,
      })
    ).toBe(0);
  });

  it('the verdict is the stated arithmetic, with the stated realisation discount, and draws nothing from the brain stream', () => {
    expect(OMAHA_BARE_OVERPAIR_CONT_REALIZATION).toBe(0.75);
    expect(realizationFactor({ street: 'flop', inPosition: false })).toBe(
      OMAHA_BARE_OVERPAIR_CONT_REALIZATION
    );
    for (const c of CLASSES)
      for (const frac of SIZES)
        for (const r of READS) {
          const st = facing(c, frac);
          const spot = omahaBareOverpairFlopFacingBetSpot(st.hero, st.gs)!;
          seedFastRandom(977);
          const before = saveFastRandom();
          const v = omahaBareOverpairFlopFacingBetVerdict(spot, st.hero, st.gs, r.read)!;
          expect(saveFastRandom()).toBe(before);
          expect(omahaBareOverpairFlopFacingBetVerdict(spot, st.hero, st.gs, r.read)).toEqual(v);
          expect(v.realization).toBe(0.75);
          expect(v.eqStrong).toBeLessThanOrEqual(v.eqRange + 1e-12);
          expect(v.eqAny).toBeGreaterThanOrEqual(v.eqRange - 1e-12);
          const p = v.equity * 0.75;
          expect(v.ev).toBeCloseTo(p * spot.pot - (1 - p) * spot.call, 6);
          expect(v.margin).toBeCloseTo(0.02 * (spot.pot + spot.call), 9);
          expect(v.call).toBe(v.ev > v.margin);
        }
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically, with no continuation receipt', () => {
    for (const c of [CLASSES[0], CLASSES[2], CLASSES[6]])
      for (const frac of SIZES)
        for (const r of [READS[0], READS[2]]) {
          const build = () => facing(c, frac);
          const unset = play(build, {}, (() => r.memory) as Reads);
          expect(contFires(unset)).toBe(0);
          for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
            const off = play(
              build,
              { omahaBareOverpairOopFlopCheck: v },
              (() => r.memory) as Reads
            );
            expect(off.bytes).toEqual(unset.bytes);
            expect(off.next).toEqual(unset.next);
          }
        }
  });

  it('receipts: a fold called, a call folded, a raise flatted or folded; a decision that agrees is returned as given', () => {
    enableBrainTelemetry();
    const on = { telemetry: true, omahaBareOverpairOopFlopCheck: true } as HorseDecideOpts;
    const fire = (c: Cls, frac: number, action: string, amount?: number) => {
      HorseMind.reset();
      drainFires();
      const st = facing(c, frac);
      const given = { action, thinkTime: 1, ...(amount === undefined ? {} : { amount }) } as never;
      const out = omahaBareOverpairFlopFacingBetRule(given, st.hero, st.gs, on);
      return {
        given,
        out,
        fires: drainFires()
          .map((f) => f.feature)
          .filter((f) => CONT.includes(f)),
      };
    };
    const callCell = [CLASSES[0], 0.33] as const;
    const foldCell = [CLASSES[0], 1] as const;
    expect(ruled(callCell[0], callCell[1], null)).toBe('call');
    expect(ruled(foldCell[0], foldCell[1], null)).toBe('fold');
    const bet = Math.round(POT * 0.33);

    const called = fire(...callCell, 'fold');
    expect(called.out).toMatchObject({ action: 'call', amount: bet });
    expect(called.fires).toEqual(['omaha_bare_overpair_oop_flop_check_called']);

    const flatted = fire(...callCell, 'raise', 500);
    expect(flatted.out).toMatchObject({ action: 'call', amount: bet });
    expect(flatted.fires).toEqual(['omaha_bare_overpair_oop_flop_check_raise_flatted']);
    const jam = fire(...callCell, 'all_in');
    expect(jam.out).toMatchObject({ action: 'call', amount: bet });
    expect(jam.fires).toEqual(['omaha_bare_overpair_oop_flop_check_raise_flatted']);

    const agreed = fire(...callCell, 'call', bet);
    expect(agreed.out).toBe(agreed.given);
    expect(agreed.fires).toEqual([]);

    for (const action of ['call', 'raise', 'all_in']) {
      const folded = fire(...foldCell, action, action === 'all_in' ? undefined : 357);
      expect(folded.out?.action).toBe('fold');
      expect(folded.out).not.toHaveProperty('amount');
      expect(folded.fires).toEqual(['omaha_bare_overpair_oop_flop_check_folded']);
    }
    const stays = fire(...foldCell, 'fold');
    expect(stays.out).toBe(stays.given);
    expect(stays.fires).toEqual([]);

    // off, and off the flop: the rule is not there
    const st = facing(callCell[0], callCell[1]);
    const given = { action: 'fold', thinkTime: 1 } as never;
    expect(omahaBareOverpairFlopFacingBetRule(given, st.hero, st.gs, {})).toBeNull();
    const turn = facingAfterCheck(TURN, 185);
    expect(omahaBareOverpairFlopFacingBetRule(given, turn.hero, turn.gs, on)).toBeNull();
  });

  it('the brain decisions it changes carry the receipt and are admitted by the worker receipt validator', () => {
    let calls = 0;
    let folds = 0;
    for (const c of [CLASSES[0], CLASSES[1], CLASSES[6]])
      for (const frac of SIZES) {
        const variant = c.hole.length === 8 ? 'plo4' : 'plo5';
        const build = () => facing(c, frac);
        const off = play(build, {});
        const on = play(build, FLOP_ON);
        on.actions.forEach((a, i) => {
          const fires = on.fires[i].filter((f) => CONT.includes(f));
          if (a === off.actions[i]) return;
          expect(fires).toEqual([
            a === 'call'
              ? 'omaha_bare_overpair_oop_flop_check_called'
              : 'omaha_bare_overpair_oop_flop_check_folded',
          ]);
          if (a === 'call') calls++;
          else folds++;
        });
        for (const s of SEEDS) {
          HorseMind.reset();
          seedFastRandom(s);
          const st = build();
          const d = structuredClone(
            HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, FLOP_ON)
          );
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), variant, {
              player: st.hero,
              gameState: st.gs,
            }),
            `${c.name} ${frac} seed ${s}`
          ).toBeNull();
        }
      }
    expect(calls).toBeGreaterThan(0);
    expect(folds).toBeGreaterThan(0);
    // the validator's own admission: the spot and the exact chips, nothing else
    const st = facing(CLASSES[0], 0.5);
    expect(omahaBareOverpairContAdmitsCall(st.hero, st.gs, Math.round(POT * 0.5))).toBe(true);
    expect(omahaBareOverpairContAdmitsCall(st.hero, st.gs, Math.round(POT * 0.5) + 1)).toBe(false);
    const turn = facingAfterCheck(TURN, 185);
    expect(omahaBareOverpairContAdmitsCall(turn.hero, turn.gs, 185)).toBe(false);
  });

  it('multiway, the whole-stack call, a hand outside the class and the Horse not having checked: today’s decision', () => {
    const c = CLASSES[0];
    const outside: [string, () => Node][] = [
      ['three-way', () => facing(c, 0.5, { threeWay: true })],
      ['the call is for the whole stack', () => facing(c, 0.5, { heroStack: 150 })],
      ['a set', () => facing({ ...c, hole: 'AsAh9s9c4h' }, 0.5)],
      ['a flush draw', () => facing({ ...c, hole: 'AdAhQd7c4h' }, 0.5)],
      ['a wrap', () => facing({ ...c, hole: 'AsAh7s6c4h' }, 0.5)],
    ];
    for (const [name, build] of outside) {
      const st = build();
      expect(omahaBareOverpairFlopFacingBetSpot(st.hero, st.gs), name).toBeNull();
      for (const r of [READS[0], READS[2]]) {
        const on = play(build, FLOP_ON, (() => r.memory) as Reads);
        expect(on.bytes, name).toEqual(play(build, {}, (() => r.memory) as Reads).bytes);
        expect(contFires(on), name).toBe(0);
      }
    }
    // facing a bet the Horse did not check to (no check of its own on the street)
    const st = facing(c, 0.5);
    const noCheck = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).filter(
        (a) => !(String(a.stage) === 'flop' && a.seat === HERO)
      ),
    };
    expect(omahaBareOverpairFlopFacingBetSpot(st.hero, noCheck as never)).toBeNull();
    expect(omahaBareOverpairFlopFacingBetSpot({ ...st.hero, bet: 20 }, st.gs)).toBeNull();
  });
});

describe('omahaBareOverpairOopFlopCheck, the spot (owner 14:19 and 14:23): every big pair with the betting lead', () => {
  /** The Horse 4-bet before the flop in the fixture: it has the lead. */
  const lead = (hole: string, board: string) => (): Node => nodeAt(FLOP, { hole, board });
  /** The same node with the caller as the last preflop aggressor: no lead. */
  const noLead = (hole: string, board: string) => (): Node => {
    const st = nodeAt(FLOP, { hole, board });
    const history = [...(st.gs.actionHistory ?? [])];
    const pre = history.filter((a) => String(a.stage) === 'preflop');
    const mine = [...pre].reverse().find((a) => a.seat === HERO && String(a.action) === 'raise')!;
    const his = [...pre].reverse().find((a) => a.seat === CALLER && String(a.action) === 'call')!;
    return {
      ...st,
      gs: {
        ...st.gs,
        actionHistory: history.map((a) =>
          a === mine ? { ...a, action: 'call' } : a === his ? { ...a, action: 'raise' } : a
        ),
      },
    } as Node;
  };
  const BIG: [string, string, string][] = [
    ['aces, 5-8-9 two-tone (the recorded hand)', 'AsAhQs7c4h', '5d8d9h'],
    ['aces, K-7-2 rainbow', 'AsAhQs9c4h', 'Kd7c2h'],
    ['kings, 9-6-2 two-tone', 'KsKhQs8c3h', '9d6d2h'],
    ['queens, 9-6-2 two-tone', 'QsQhJs4c3h', '9d6d2h'],
    ['jacks, an overpair on a ten-high flop', 'JsJhKs4c3h', 'Td6d2h'],
    ['queens with one overcard, an ace-high flop', 'QsQhJs8c3h', 'Ad7d2h'],
    ['kings with one overcard, an ace-high flop', 'KsKhJs8c3h', 'Ad7d2h'],
  ];
  const OUTSIDE: [string, string, string][] = [
    ['top pair made by a board card', 'AsKhQsJc2h', 'Ad8d3h'],
    ['a small pocket pair under the board', '9s9hQs4c3h', 'Kd7d2h'],
    ['jacks with one overcard', 'JsJhTs4c3h', 'Ad7d2h'],
    ['queens with two overcards', 'QsQhJs4c3h', 'AdKd2h'],
    ['aces with a flush draw', 'AdAhQd7c4h', '5d8d9h'],
    ['aces with a wrap', 'AsAh7s6c4h', '5d8d9h'],
    ['a set of aces', 'AsAhQs7c4h', 'Ad8d3h'],
    ['aces and two pair', 'AsAhKs7c4h', 'Kd7d2h'],
  ];

  it('the hand: a pocket overpair, or queens or better with at most one overcard; one pair, backdoor draws only', () => {
    for (const [name, hole, board] of BIG)
      expect(omahaBareBigPairOnFlop(cards(hole), cards(board)), name).toBe(true);
    for (const [name, hole, board] of OUTSIDE)
      expect(omahaBareBigPairOnFlop(cards(hole), cards(board)), name).toBe(false);
    // PLO4 too
    expect(omahaBareBigPairOnFlop(cards('QsQhJs4c'), cards('9d6d2h'))).toBe(true);
    expect(omahaBareBigPairOnFlop(cards('AsKhQsJc'), cards('Ad8d3h'))).toBe(false);
  });

  it('the lead: the last preflop bet or raise was the Horse’s; a caller, a limped pot and a flat all-in are not', () => {
    const st = lead('AsAhQs7c4h', '5d8d9h')();
    expect(omahaHeroHasPreflopLead(st.hero, st.gs)).toBe(true);
    const off = noLead('AsAhQs7c4h', '5d8d9h')();
    expect(omahaHeroHasPreflopLead(off.hero, off.gs)).toBe(false);
    const limped = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).map((a) =>
        String(a.stage) === 'preflop' && String(a.action) === 'raise' ? { ...a, action: 'call' } : a
      ),
    };
    expect(omahaHeroHasPreflopLead(st.hero, limped as never)).toBe(false);
    const flatJam = {
      ...st.gs,
      actionHistory: [
        ...(st.gs.actionHistory ?? []).filter((a) => String(a.stage) === 'preflop'),
        { stage: 'preflop', seat: CALLER, action: 'all_in', amount: 148, isFullRaise: false },
      ],
    };
    expect(omahaHeroHasPreflopLead(st.hero, flatJam as never)).toBe(true);
  });

  it('with the lead: every big pair is the spot and checks at every seed, with the receipt where the brain bet', () => {
    let bets = 0;
    for (const [name, hole, board] of BIG) {
      const build = lead(hole, board);
      const st = build();
      expect(omahaBareOverpairOopFlopSpot(st.hero, st.gs), name).toBe(true);
      const off = play(build, {});
      const on = play(build, FLOP_ON);
      expect(wagers(on), name).toBe(0);
      expect(hasFire(on, 'omaha_bare_overpair_oop_flop_checked'), name).toBe(wagers(off));
      expect(on.next, name).toEqual(off.next);
      bets += wagers(off);
      // unset, false and truthy non-boolean: the same bytes
      for (const v of [false, 1 as unknown as boolean])
        expect(play(build, { omahaBareOverpairOopFlopCheck: v }).bytes, name).toEqual(off.bytes);
    }
    expect(bets).toBeGreaterThan(0);
  });

  it('without the lead: the same hands are not the spot and decide as today', () => {
    for (const [name, hole, board] of BIG) {
      const build = noLead(hole, board);
      const st = build();
      expect(omahaBareOverpairOopFlopSpot(st.hero, st.gs), name).toBe(false);
      const on = play(build, FLOP_ON);
      expect(on.bytes, name).toEqual(play(build, {}).bytes);
      expect(hasFire(on, 'omaha_bare_overpair_oop_flop_checked'), name).toBe(0);
    }
  });

  it('with the lead but outside the class (top pair from the board, small pairs, real draws, sets): as today', () => {
    for (const [name, hole, board] of OUTSIDE) {
      const build = lead(hole, board);
      const st = build();
      expect(omahaBareOverpairOopFlopSpot(st.hero, st.gs), name).toBe(false);
      const on = play(build, FLOP_ON);
      expect(on.bytes, name).toEqual(play(build, {}).bytes);
      expect(hasFire(on, 'omaha_bare_overpair_oop_flop_checked'), name).toBe(0);
    }
  });

  it('the continuation needs the lead too: without it the checked big pair facing a bet decides as today', () => {
    for (const frac of [0.33, 1]) {
      const build = (): Node => {
        const st = facingAfterCheck(FLOP, Math.round(357 * frac));
        const history = [...(st.gs.actionHistory ?? [])];
        const pre = history.filter((a) => String(a.stage) === 'preflop');
        const mine = [...pre]
          .reverse()
          .find((a) => a.seat === HERO && String(a.action) === 'raise')!;
        const his = [...pre]
          .reverse()
          .find((a) => a.seat === CALLER && String(a.action) === 'call')!;
        return {
          ...st,
          gs: {
            ...st.gs,
            actionHistory: history.map((a) =>
              a === mine ? { ...a, action: 'call' } : a === his ? { ...a, action: 'raise' } : a
            ),
          },
        } as Node;
      };
      const st = build();
      expect(omahaBareOverpairFlopFacingBetSpot(st.hero, st.gs)).toBeNull();
      const on = play(build, FLOP_ON);
      expect(on.bytes).toEqual(play(build, {}).bytes);
    }
  });
});
