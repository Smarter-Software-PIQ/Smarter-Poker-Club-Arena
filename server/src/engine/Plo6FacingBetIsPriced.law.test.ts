/**
 * LAW: with plo6FacingBetIsPriced on, a PLO6 cash Horse facing a bet answers by price; off, nothing changes.
 *
 * Audit HVH48 auditor C (archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/C-plo6): 183 PLO6 fold
 * mistakes against people, decided by the random-hand river fold (plo6RiverNutDiscipline, V58/V59), the class
 * ceilings (V15/V40/V87) and the paired-board fold. The fixtures are the audit's own hands, anonymised
 * (Plo6FacingBetIsPriced.fixture.json), replayed through HorseLogic.decide as the audit replayed them
 * (HorseComplaintReplay.stateAt, the live cash profile, opponent memory off, seeds 1, 7, 42).
 *
 *   1. Red off, green on: the folds the audit flagged that the priced verdict calls (#59974054 flush and
 *      #59972261 straight getting 2:1 on the river, #60060560 flop trips, #59973455 and #60040999 the turn,
 *      #60067736 the flop all-in, #60093920 the paired flop) fold off and call on, every seed.
 *   2. The river raise cases (#60074744, #60077887) and the other river spots (#59974302 aces full facing a
 *      river raise on 2-2-2, #59973335, #60069935): on, the answer is the priced one (the verdict's action),
 *      never the random-hand rule's (its receipts do not fire; the rule records that it did not run).
 *   3. No PLO6 facing-bet fold is decided by a random-hand share: on every fixture node and on a set of
 *      re-dealt river spots, every fold the Horse makes facing a bet is the priced verdict's fold, and the V58 /
 *      V59 receipts never fire (off, they do fire on the same spots).
 *   4. Off is the brain as it was: unset, false and a truthy non-boolean decide byte for byte alike.
 *   5. Every decision made with the option on passes the receipt validator on its own request.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HorseLogic, plo6FacingBetPricedVerdictOf, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  actionKind,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import type { Card } from '../types.js';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Plo6FacingBetIsPriced.fixture.json'),
    'utf8'
  )
) as { hands: { hand: ExtractedHand; ords: number[]; ids: Record<string, string> }[] };

/** Production's switch set on the audit day (the audit's own replay set), as the audit replayed it. */
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42];
const ON: HorseDecideOpts = { plo6FacingBetIsPriced: true };

interface Node {
  id: string;
  handNumber: number;
  hand: ExtractedHand;
  node: ComplaintAction;
}
const NODES: Node[] = FIXTURE.hands.flatMap((h) =>
  h.ords.map((ord) => ({
    id: h.ids[String(ord)],
    handNumber: Number((h.hand as unknown as { handNumber: number }).handNumber),
    hand: h.hand,
    node: h.hand.actions.find((a) => (a as unknown as { ord: number }).ord === ord)!,
  }))
);
const byHand = (n: number): Node => {
  const found = NODES.find((x) => x.handNumber === n);
  if (!found) throw new Error(`fixture hand ${n} missing`);
  return found;
};

interface Played {
  kinds: string[];
  bytes: string[];
  fires: string[][];
  decisions: unknown[];
}
function play(n: Node, opts: HorseDecideOpts | Record<string, unknown>): Played {
  enableBrainTelemetry();
  const out: Played = { kinds: [], bytes: [], fires: [], decisions: [] };
  for (const seed of SEEDS) {
    seedFastRandom(seed);
    HorseMind.reset();
    drainFires();
    const st = stateAt(n.hand, n.node);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never);
    out.kinds.push(actionKind(d.action, d.amount, st.pn));
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.fires.push(drainFires().map((f) => f.feature));
    out.decisions.push(d);
  }
  HorseMind.reset();
  return out;
}
const RANDOM_HAND_RECEIPTS = [
  'v58_plo6_river_fold',
  'v59_plo6_river_unpaired_fold',
  'v58_plo6_river_raise_to_call',
  'v59_plo6_river_unpaired_raise_to_call',
];
const firedAny = (p: Played, keys: string[]) =>
  p.fires.filter((f) => keys.some((k) => f.includes(k))).length;

afterEach(() => {
  HorseMind.reset();
});

describe('plo6FacingBetIsPriced: the audit folds the price calls (red off, green on)', () => {
  const CALLED = [59974054, 59972261, 60060560, 59973455, 60040999, 60067736, 60093920];
  for (const hn of CALLED) {
    it(`#${hn}: off folds, on calls at every seed`, () => {
      const n = byHand(hn);
      const off = play(n, {});
      expect(off.kinds).toEqual(['fold', 'fold', 'fold']);
      const on = play(n, ON);
      expect(on.kinds.every((k) => k === 'call')).toBe(true);
      const st = stateAt(n.hand, n.node);
      const v = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
      expect(v).not.toBeNull();
      expect(v!.callPriced).toBe(true);
      expect(v!.evCall).toBeGreaterThan(v!.margin);
    });
  }
});

describe('plo6FacingBetIsPriced: the river answer is the priced one, never the random-hand rule', () => {
  const RIVER = [59974302, 59973335, 60069935, 60074744, 60077887];
  for (const hn of RIVER) {
    it(`#${hn}: on, the action is the verdict's and no random-hand receipt fires`, () => {
      const n = byHand(hn);
      const st = stateAt(n.hand, n.node);
      const v = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
      expect(v).not.toBeNull();
      expect(v!.street).toBe('river');
      const on = play(n, ON);
      const want = v!.action === 'all_in' ? 'jam' : v!.action;
      for (const k of on.kinds) expect(k === want || (want === 'raise' && k === 'jam')).toBe(true);
      expect(firedAny(on, RANDOM_HAND_RECEIPTS)).toBe(0);
      expect(firedAny(on, ['plo6_facing_bet_priced_river_nut_rule_not_run'])).toBe(SEEDS.length);
    });
  }
  it('#59974302 and #59973335 reach the random-hand rule with the option off', () => {
    for (const hn of [59974302, 59973335]) {
      const off = play(byHand(hn), {});
      expect(firedAny(off, RANDOM_HAND_RECEIPTS)).toBe(SEEDS.length);
    }
  });
});

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
/** A river fixture re-dealt: new hole cards for the Horse and a new board, the betting as recorded. */
function redealt(n: Node, seed: number): Node {
  const copy = JSON.parse(JSON.stringify(n.hand)) as ExtractedHand & {
    horseHoleCards: Record<string, Card[]>;
  };
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0;
    return a / 4294967296;
  };
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s } as Card);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const ord = (n.node as unknown as { ord: number }).ord;
  const node = copy.actions.find((x) => (x as unknown as { ord: number }).ord === ord)!;
  const pn = node.publicNode!;
  const heroSeat = pn.actorSeat ?? node.seat;
  const heroId = (copy.players as unknown as { seat: number; userId: string }[]).find(
    (p) => p.seat === heroSeat
  )!.userId;
  const letter: Record<string, string> = { clubs: 'c', diamonds: 'd', hearts: 'h', spades: 's' };
  (pn as unknown as { boards: string[] }).boards = [
    deck
      .slice(0, 5)
      .map((c) => `${c.rank}${letter[c.suit]}`)
      .join(''),
  ];
  copy.horseHoleCards[heroId] = deck.slice(5, 11);
  return { ...n, hand: copy, node };
}

describe('plo6FacingBetIsPriced: no PLO6 facing-bet fold is decided by a random-hand share', () => {
  it('every fold facing a bet is the priced fold, and V58/V59 never fire (they do, off)', () => {
    const riverNodes = NODES.filter((n) => stateAt(n.hand, n.node).gs.stage === 'river');
    expect(riverNodes.length).toBeGreaterThanOrEqual(5);
    const spots: Node[] = [...NODES];
    for (const n of riverNodes)
      for (let s = 1; s <= 8; s++) spots.push(redealt(n, s * 7919 + n.handNumber));
    let folds = 0;
    let offRandomFires = 0;
    let onRandomFires = 0;
    let checked = 0;
    for (const n of spots) {
      let st: ReturnType<typeof stateAt>;
      try {
        st = stateAt(n.hand, n.node);
      } catch {
        continue;
      }
      if (!((st.gs.toCall ?? 0) > 0.005)) continue;
      checked++;
      const on = play(n, ON);
      onRandomFires += firedAny(on, RANDOM_HAND_RECEIPTS);
      const v = plo6FacingBetPricedVerdictOf(st.hero, st.gs);
      on.kinds.forEach((k) => {
        if (k !== 'fold') return;
        folds++;
        // A fold stands only where the price folds (or nothing could be priced).
        expect(v === null || v.action === 'fold').toBe(true);
        if (v) expect(v.callPriced).toBe(false);
      });
      offRandomFires += firedAny(play(n, {}), RANDOM_HAND_RECEIPTS);
    }
    expect(checked).toBeGreaterThanOrEqual(40);
    expect(folds).toBeGreaterThan(0);
    expect(onRandomFires).toBe(0);
    expect(offRandomFires).toBeGreaterThan(0);
  });
});

describe('plo6FacingBetIsPriced off is the brain as it was', () => {
  it('unset, false and a truthy non-boolean decide byte for byte alike, with the same receipts', () => {
    for (const n of NODES) {
      const unset = play(n, {});
      const off = play(n, { plo6FacingBetIsPriced: false });
      const truthy = play(n, { plo6FacingBetIsPriced: 'yes' });
      expect(off.bytes).toEqual(unset.bytes);
      expect(truthy.bytes).toEqual(unset.bytes);
      expect(off.fires).toEqual(unset.fires);
      expect(truthy.fires).toEqual(unset.fires);
      for (const f of unset.fires)
        expect(f.some((k) => k.startsWith('plo6_facing_bet_priced_'))).toBe(false);
    }
  });
});

describe('plo6FacingBetIsPriced: the receipt validator admits every decision it makes', () => {
  it('each on decision passes horseDecisionReceiptRefusal on its own request, under its own option', () => {
    for (const n of NODES) {
      const on = play(n, ON);
      const st = stateAt(n.hand, n.node);
      for (const d of on.decisions)
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), 'plo6', {
            player: st.hero,
            gameState: st.gs,
            plo6FacingBetIsPriced: true,
          })
        ).toBeNull();
    }
  });

  it("review N4: its fold -> call is admitted only under the decision's own option", () => {
    // A fold -> call that the option made, validated without the option (a decision the worker ran with the
    // option off), is refused: the verdict's superset no longer admits a PLO6 call from another cause.
    let gated = 0;
    for (const n of NODES) {
      const on = play(n, ON);
      const st = stateAt(n.hand, n.node);
      for (const d of on.decisions) {
        const ctx = { player: st.hero, gameState: st.gs };
        const graph = (d as { policyGraph?: { transitions: Array<Record<string, unknown>> } })
          .policyGraph;
        const node = graph?.transitions.find((t) => t.node === 'wager_rules');
        const before = node?.before as { action?: string } | null | undefined;
        const after = node?.after as { action?: string } | undefined;
        if (
          after?.action !== 'call' ||
          !before ||
          !['fold', 'raise', 'all_in'].includes(String(before.action))
        )
          continue;
        if (horseDecisionReceiptRefusal(structuredClone(d), 'plo6', ctx) === null) continue;
        gated++;
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), 'plo6', {
            ...ctx,
            plo6FacingBetIsPriced: true,
          })
        ).toBeNull();
      }
    }
    expect(gated).toBeGreaterThan(0);
  });
});
