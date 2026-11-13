/**
 * PLO6-AUDIT-010 through HorseLogic.decide: the token-price call bar, its
 * default, its scope and its control switch, at a real public node.
 *
 * Production hand 58466632 (PLO6 0.10/0.25 cash), decision 17: on the flop
 * 8h Ac 3h a Horse with a pair of aces and 7.95 behind faces 14.56 to call
 * into 66.18. The effective call is its stack, about an eighth of the final
 * pot. With the stack-off premiums at full size the committed-call bar folds
 * it; with the premiums scaled to the price it calls. The fixture is the
 * anonymised recorded hand (seats only), replayed with opponent memory off
 * for the live hybrid profile and every base style over the fixed seeds.
 *
 * The under-one-percent river clause is pinned at the real river node of
 * production hand 58750626 (3 chips to call into 2,577). The recorded fold
 * of a set there depended on the Horse's opponent read frame, which a public
 * node does not carry, so the node is replayed with other hole cards for the
 * acting seat: hands that beat many random hands are folded by the old bar
 * and called by the new one, and a hand that beats almost nothing still
 * folds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { replayHand, type ComplaintFixture } from './HorseComplaintReplay.js';
import FIXTURE from './fixtures/horse-plo6-token-priced-call-58466632.json';
import RIVER_FIXTURE from './fixtures/horse-plo6-river-token-call-58750626.json';
import type { Card, CardRank, CardSuit } from '../types.js';

const FX = FIXTURE as unknown as ComplaintFixture;
const ORD = 17;
const HERO_SEAT = 3;
const OFF = { tokenCallPrice: false };

/** Every profile's action counts at the node, as { profile: { action: seeds } }. */
function actionsAt(fixture: ComplaintFixture, opts?: Record<string, unknown>) {
  const [node] = replayHand(fixture, { ords: [ORD], opts });
  return Object.fromEntries(node.profiles.map((p) => [p.profile, p.actions]));
}

function variant(edit: (fixture: ComplaintFixture, node: Record<string, unknown>) => void) {
  const copy = structuredClone(FX);
  const action = copy.actions.find((a) => a.ord === ORD)!;
  edit(copy, action.publicNode as unknown as Record<string, unknown>);
  return copy;
}

const everyProfile = (actions: Record<string, Record<string, number>>, action: string) =>
  Object.values(actions).every((a) => Object.keys(a).length === 1 && a[action] > 0);

describe('a token-priced Omaha call through decide (PLO6-AUDIT-010)', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded node: stack 7.95, 14.56 to call into 66.18, fold or call only', () => {
    const node = FX.actions.find((a) => a.ord === ORD)!.publicNode!;
    expect(FX.variant).toBe('plo6');
    expect(FX.fmt).toBe('cash');
    expect(node.pot).toBe(66.18);
    expect(node.toCall).toBe(14.56);
    expect(node.seats.find((s) => s[0] === HERO_SEAT)![1]).toBe(7.95);
    expect(node.legalActions).toEqual(['fold', 'call', 'all_in']);
  });

  it('the rule is counted where it moves the bar, and not when it is off', () => {
    const fires = (opts?: Record<string, unknown>) => {
      const [node] = replayHand(FX, { ords: [ORD], opts });
      return node.profiles.map((p) => p.receipts.token_call_price_scaled ?? 0);
    };
    expect(fires().every((n) => n > 0)).toBe(true);
    expect(fires(OFF).every((n) => n === 0)).toBe(true);
  });

  it('default: no profile folds it at any seed', () => {
    expect(everyProfile(actionsAt(FX), 'all_in')).toBe(true);
  });

  it('control: with the rule off every profile folds it, so the default is not vacuous', () => {
    expect(everyProfile(actionsAt(FX, OFF), 'fold')).toBe(true);
  });

  it('at a price of 0.15 or more the action is the same with the rule on or off', () => {
    // 40 behind: the whole 14.56 is owed, 18% of the final pot.
    const deep = variant((_f, node) => {
      (node.seats as number[][]).find((s) => s[0] === HERO_SEAT)![1] = 40;
    });
    const on = actionsAt(deep);
    expect(on).toEqual(actionsAt(deep, OFF));
    expect(everyProfile(on, 'fold')).toBe(true);
  });

  it('a tournament is out of scope: the same node folds with the rule on or off', () => {
    const tournament = variant((fixture) => {
      fixture.fmt = 'tour';
      for (const a of fixture.actions) if (a.publicNode) a.publicNode.mode = 'tournament';
    });
    const on = actionsAt(tournament);
    expect(on).toEqual(actionsAt(tournament, OFF));
    expect(everyProfile(on, 'fold')).toBe(true);
  });
});

const RIVER = RIVER_FIXTURE as unknown as ComplaintFixture;
const RIVER_ORD = 22;
const RIVER_SEAT = '2';
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((c) => ({ rank: c[0] as CardRank, suit: SUIT[c[1]] }));

function riverActions(hole: string, opts?: Record<string, unknown>) {
  const copy = structuredClone(RIVER);
  copy.hole[RIVER_SEAT] = cards(hole);
  const [node] = replayHand(copy, { ords: [RIVER_ORD], opts });
  return Object.fromEntries(node.profiles.map((p) => [p.profile, p.actions]));
}

describe('a river call under one percent of the pot through decide (PLO6-AUDIT-010)', () => {
  afterEach(() => HorseMind.reset());

  it('the fixture is the recorded node: Qd Ah 6c 8s 9d, 3 behind, 205 to call into 2,577', () => {
    const node = RIVER.actions.find((a) => a.ord === RIVER_ORD)!.publicNode!;
    expect(RIVER.variant).toBe('plo6');
    expect(node.boards).toEqual(['QdAh6c8s9d']);
    expect(node.pot).toBe(2577);
    expect(node.toCall).toBe(205);
    expect(node.seats.find((s) => s[0] === Number(RIVER_SEAT))![1]).toBe(3);
  });

  it('two pair and one pair of kings: the old bar folds them, the counted bound calls', () => {
    for (const hole of ['3hKd8c2cJh9s', '3hKdKc2cJh4s']) {
      expect(everyProfile(riverActions(hole, OFF), 'fold')).toBe(true);
      expect(everyProfile(riverActions(hole), 'all_in')).toBe(true);
    }
  });

  it('a pair of deuces that beats almost nothing still folds, rule on or off', () => {
    const on = riverActions('3h2d4c2hJh5s');
    expect(everyProfile(on, 'fold')).toBe(true);
    expect(on).toEqual(riverActions('3h2d4c2hJh5s', OFF));
  });

  it('the recorded set of queens is called with the rule on', () => {
    expect(everyProfile(riverActions('3hKdQcQhJh9s'), 'all_in')).toBe(true);
  });
});
