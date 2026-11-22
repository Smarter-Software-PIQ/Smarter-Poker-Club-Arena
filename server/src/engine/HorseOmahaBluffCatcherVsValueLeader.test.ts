/**
 * OMAHA BLUFF-CATCHER FOLD VS A VALUE LEADER (2026-11-15; option
 * omahaBluffCatcherFoldVsValueLeader, default OFF).
 *
 * The bluff-catcher cells of omahaBluffCatcherRaiseFold (unchanged) fold only
 * when the player whose bet or raise the Horse faces is a MEASURED postflop
 * value leader (HorseMind.omahaReadConditionalOf: measured and valueLeader).
 *
 * The nodes are the recorded bluff-catcher spots of
 * HorseOmahaMadeHandDefense.test.ts, read from the complaint fixtures: hand
 * 59416584's turn with deep stacks (the set bets and is raised 0.9 pot or
 * more) and hand 59414191's river continued (the set bets and is raised the
 * pot). The option needs the mind on, and with the mind on today's brain
 * calls the turn raise with top set (with or without kings behind it) and
 * already folds the river node on its own, so the turn nodes carry the
 * decision cases and the river node is pinned as unchanged.
 *
 *  - unset, false and a truthy non-boolean decide byte-identically, with no
 *    receipt of the option;
 *  - on: an unknown, presumed (not measured) or measured non-value-leader
 *    player faced gives today's decision, with the withheld receipt;
 *  - on: a measured value leader faced gets the fold, with its receipt; only
 *    the read of the player faced is asked;
 *  - the unconditional rule's exceptions stay (the priced turn redraw, the
 *    measured postflop over-bluffer); the mind off and the unconditional
 *    option on are untouched; the rule draws no random number; the fold is
 *    admitted by the worker receipt validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import SET_RAISES_TURN from './horseComplaints/plo5-set-raises-a-pot-turn-lead-on-the-straight-card.fixture.json';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';

/** Hand 59414191: the set in seat 4. */
const FA = SET_RAISES_TURN as unknown as ComplaintFixture;
/** Hand 59416584: the set in seat 4. */
const FB4 = SET_LEADS as unknown as ComplaintFixture;

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

// Sixteen seeds on which today's brain calls both turn nodes. The call with top set and the king
// redraw is a close one for the reference brain: seed 3036 folded it before 2026-11-19, and since the
// Omaha band fallback measures in the band's unit (AUDIT-FILES-B) seed 3001 folds it too (2 of 40
// seeds from 3000). The option's laws below are about the seeds that call, so 3001 is left out.
const SEEDS = Array.from({ length: 17 }, (_, i) => 3000 + i).filter((s) => s !== 3001);
const LIVE = replayProfiles('cash').find((p) => p.live)!;

interface Variation {
  hole?: string;
  node?: (pn: ComplaintPublicNode) => void;
  actions?: (fx: ComplaintFixture) => void;
}
function spot(base: ComplaintFixture, ord: number, v: Variation = {}) {
  const fx = JSON.parse(JSON.stringify(base)) as ComplaintFixture;
  v.actions?.(fx);
  const node = fx.actions.find((a) => a.ord === ord)!;
  if (v.hole) fx.hole[String(node.seat)] = cards(v.hole);
  v.node?.(node.publicNode!);
  return stateAt(fx, node);
}

/** Hand 59414191's river, continued: the set bets 177 and is raised to 708. */
const riverRaised: Variation = {
  actions: (fx) => {
    const lead = fx.actions.find((a) => a.ord === 22)!;
    const pn = JSON.parse(JSON.stringify(lead.publicNode)) as ComplaintPublicNode;
    const raise = fx.actions.find((a) => a.ord === 23)!;
    raise.action = 'raise';
    raise.amount = 708;
    raise.isFullRaise = true;
    pn.pot = 1305;
    pn.toCall = 531;
    pn.currentBet = 708;
    pn.seats[3] = [4, 716, 177, 372, 0, 0, 0];
    pn.seats[5] = [6, 2458.1, 708, 903, 0, 0, 0];
    pn.minRaiseTo = null as never;
    pn.maxRaiseTo = null as never;
    pn.legalActions = ['fold', 'call', 'all_in'];
    fx.actions.push({
      ord: 24,
      seat: 4,
      stage: 'river',
      action: 'call',
      amount: 531,
      origin: 'horse_policy',
      publicNode: pn,
    } as ComplaintAction);
  },
};
/** Hand 59416584's turn with deep stacks: the set bets 212 and is raised to 848. */
const turnRaised: Variation = {
  actions: (fx) => {
    const jam = fx.actions.find((a) => a.ord === 19)!;
    jam.action = 'raise';
    jam.amount = 848;
    jam.isFullRaise = true;
  },
  node: (pn) => {
    pn.pot = 1573;
    pn.toCall = 636;
    pn.currentBet = 848;
    pn.seats[3] = [4, 2000, 212, 444, 0, 0, 0];
    pn.seats[4] = [5, 2000, 848, 1080, 0, 0, 0];
    pn.minRaiseTo = 1484;
    pn.maxRaiseTo = 2212;
    pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  },
};
const RIVER = () => spot(FA, 24, riverRaised);
/** Top set on A 3 T K, the wheel-less broadway straight possible: no redraw that pays. */
const TURN_TOP_SET = () => spot(FB4, 20, { ...turnRaised, hole: 'AdAs8d9c2s' });
const TURN_TOP_SET_KINGS = () => spot(FB4, 20, { ...turnRaised, hole: 'AdAsKdKc2s' });
/** Top set with the gutshot to the nut straight: the redraw pays the price. */
const TURN_REDRAW = () => spot(FB4, 20, { ...turnRaised, hole: 'AdAsQd9c2s' });
const NODES = [TURN_TOP_SET, TURN_TOP_SET_KINGS] as const;
const calls = (o: Outcome) => o.actions.filter((a) => a === 'call').length;

const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
  asked: string[][];
}
type Reads = (userId: string) => OmahaReadConditional | null;
function play(
  build: () => ReturnType<typeof spot>,
  opts: HorseDecideOpts,
  reads?: Reads,
  before?: () => void
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [], asked: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    const asked: string[] = [];
    if (reads)
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(((id: string) => {
        asked.push(id);
        return reads(id);
      }) as never);
    before?.();
    drainFires();
    seedFastRandom(s);
    const st = build();
    // mind on (the default): the read is consulted only with the opponent memory present
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    out.asked.push(asked);
    vi.restoreAllMocks();
  }
  return out;
}
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const folds = (o: Outcome) => o.actions.filter((a) => a === 'fold').length;

const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;
const notLeader = {
  measured: true,
  tightReRaiser: false,
  valueLeader: false,
} as OmahaReadConditional;
/** A presumed read: never measured (the module never reports valueLeader without measured;
 * the gate asks for both, so even a value-leader flag on an unmeasured read does not count). */
const presumed = {
  measured: false,
  tightReRaiser: false,
  valueLeader: true,
} as OmahaReadConditional;
const ON: HorseDecideOpts = { omahaBluffCatcherFoldVsValueLeader: true };
const APPLIED = 'omaha_bluff_catcher_fold_vs_value_leader';
const WITHHELD = 'omaha_bluff_catcher_fold_vs_value_leader_withheld';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('omahaBluffCatcherFoldVsValueLeader', () => {
  it('off: unset, false and a truthy non-boolean decide byte-identically, without its receipts', () => {
    for (const build of NODES) {
      const unset = play(build, {}, () => leader);
      expect(calls(unset)).toBe(SEEDS.length);
      expect(hasFire(unset, APPLIED)).toBe(0);
      expect(hasFire(unset, WITHHELD)).toBe(0);
      expect(hasFire(unset, 'omaha_bluff_catcher_raise_fold')).toBe(0);
      expect(unset.asked.flat()).toEqual([]);
      for (const opts of [
        { omahaBluffCatcherFoldVsValueLeader: false },
        { omahaBluffCatcherFoldVsValueLeader: 1 as unknown as boolean },
      ]) {
        const off = play(build, opts, () => leader);
        expect(off.bytes).toEqual(unset.bytes);
        expect(off.next).toEqual(unset.next);
        expect(hasFire(off, APPLIED) + hasFire(off, WITHHELD)).toBe(0);
        expect(off.asked.flat()).toEqual([]);
      }
    }
  });

  it('a measured value leader raises: the bluff catcher folds, with the receipt', () => {
    for (const build of NODES) {
      const off = play(build, {});
      expect(calls(off)).toBe(SEEDS.length);
      const on = play(build, ON, () => leader);
      expect(folds(on)).toBe(SEEDS.length);
      expect(hasFire(on, APPLIED)).toBe(SEEDS.length);
      expect(hasFire(on, WITHHELD)).toBe(0);
      // its own receipt only: the unconditional option's receipt belongs to that option
      expect(hasFire(on, 'omaha_bluff_catcher_raise_fold')).toBe(0);
      const unconditional = play(build, { omahaBluffCatcherRaiseFold: true }, () => leader);
      expect(hasFire(unconditional, 'omaha_bluff_catcher_raise_fold')).toBe(SEEDS.length);
      expect(hasFire(unconditional, APPLIED)).toBe(0);
      // the rule draws nothing from the brain's random stream
      expect(on.next).toEqual(off.next);
    }
  });

  it('only the player whose raise is faced is asked', () => {
    const raiser = TURN_TOP_SET().gs.players.find((p) => p.seat === 5)!.user_id;
    const onlyRaiser: Reads = (id) => (id === raiser ? leader : notLeader);
    const on = play(TURN_TOP_SET, ON, onlyRaiser);
    expect(folds(on)).toBe(SEEDS.length);
    expect(new Set(on.asked.flat())).toEqual(new Set([raiser]));
    const others: Reads = (id) => (id === raiser ? notLeader : leader);
    expect(folds(play(TURN_TOP_SET, ON, others))).toBe(0);
  });

  it('an unknown or presumed player, or a measured player who is no value leader: today’s play, withheld', () => {
    for (const build of NODES) {
      const off = play(build, {});
      for (const reads of [() => null, () => presumed, () => notLeader] as Reads[]) {
        const on = play(build, ON, reads);
        expect(on.bytes).toEqual(off.bytes);
        expect(on.next).toEqual(off.next);
        expect(hasFire(on, WITHHELD)).toBe(SEEDS.length);
        expect(hasFire(on, APPLIED)).toBe(0);
        expect(hasFire(on, 'omaha_bluff_catcher_raise_fold')).toBe(0);
      }
      // the real read on an empty opponent memory: unknown, today's play
      const real = play(build, ON);
      expect(real.bytes).toEqual(off.bytes);
      expect(hasFire(real, WITHHELD)).toBe(SEEDS.length);
    }
  });

  it('the exceptions of the unconditional rule stay', () => {
    // the priced turn redraw calls, and the read is not asked
    const base = play(TURN_REDRAW, {});
    expect(calls(base)).toBe(SEEDS.length);
    const redraw = play(TURN_REDRAW, ON, () => leader);
    expect(redraw.bytes).toEqual(base.bytes);
    expect(hasFire(redraw, APPLIED) + hasFire(redraw, WITHHELD)).toBe(0);
    expect(redraw.asked.flat()).toEqual([]);
    // a measured postflop over-bluffer (the sustained postflop-maniac read): the cell's own
    // exception (unchanged, HorseOmahaMadeHandDefense.test.ts) is handed the same read; with
    // the mind on today's brain raises this player instead of calling, and the option
    // leaves that decision alone
    const raiser = TURN_TOP_SET().gs.players.find((p) => p.seat === 5)!.user_id;
    const overBluffer = () =>
      vi
        .spyOn(HorseMind, 'opponentRead')
        .mockImplementation(((id: string) =>
          id === raiser
            ? { stats: { betCheckedTo: { engaged: 'high', mean: 0.9 } } }
            : null) as never);
    const today = play(TURN_TOP_SET, {}, undefined, overBluffer);
    const kept = play(TURN_TOP_SET, ON, () => leader, overBluffer);
    expect(kept.bytes).toEqual(today.bytes);
    expect(hasFire(kept, APPLIED) + hasFire(kept, WITHHELD)).toBe(0);
  });

  it('the recorded river node: with the mind on the brain already folds, and the option changes nothing', () => {
    const off = play(RIVER, {});
    expect(folds(off)).toBe(SEEDS.length);
    const on = play(RIVER, ON, () => leader);
    expect(on.bytes).toEqual(off.bytes);
    expect(hasFire(on, APPLIED) + hasFire(on, WITHHELD)).toBe(0);
  });

  it('the mind off: no read is consulted, today’s play', () => {
    for (const build of NODES) {
      const on = play(build, { ...ON, mind: false }, () => leader);
      expect(on.bytes).toEqual(play(build, { mind: false }).bytes);
      expect(on.asked.flat()).toEqual([]);
    }
  });

  it('with the unconditional option on it changes nothing', () => {
    for (const build of NODES) {
      const parent = play(build, { omahaBluffCatcherRaiseFold: true }, () => notLeader);
      const both = play(build, { ...ON, omahaBluffCatcherRaiseFold: true }, () => notLeader);
      expect(folds(parent)).toBe(SEEDS.length);
      expect(both.bytes).toEqual(parent.bytes);
      expect(hasFire(both, APPLIED) + hasFire(both, WITHHELD)).toBe(0);
    }
  });

  it('the fold is admitted by the worker receipt validator', () => {
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
    for (const build of NODES) {
      seedFastRandom(7);
      HorseMind.reset();
      const st = build();
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
      expect(d.action).toBe('fold');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });
});
