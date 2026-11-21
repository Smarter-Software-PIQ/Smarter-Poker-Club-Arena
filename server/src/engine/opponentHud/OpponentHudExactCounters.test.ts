/**
 * OPPONENT HUD EXACT COUNTERS (2026-11-21, lane OPPONENT-HUD-5). Pinned-statistic tests of the size-resolved first
 * wager (CORE-EXTEND-2's spec CORE-EXTEND-2-HUD-SIZE-COUNT-SPEC.md), the first bettor's answer to a raise, and the
 * answers to a flop continuation bet (CBET-BUTTON-4's spec CBET-DEFENCE-4-HUD-CBET-RAISE-SPEC.md). Laws:
 *  - every registered counter is produced by a constructed hand, at the cell and bin the definition names;
 *  - the bins of a cell sum to that cell's bets, for every seat of every generated hand; opps = the answers summed;
 *  - the continuation-bet counts equal the bench recorder's (a line-for-line port of cbRecObserver) on generated
 *    hands, and the two places where the written definition and the recorder part are pinned as such;
 *  - ADDITIVE: no existing read changes, and a profile built before the counters existed reads as null, never zeros.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HUD_CBR_SIZES,
  HUD_EXACT_COUNTERS,
  HUD_FW_BINS,
  HUD_FW_EDGES,
  HUD_STATS,
  applyHudHand,
  emptyHudProfile,
  extractHandDeltas,
  handRecordFromRow,
  hudCbrSize,
  hudFwBin,
  hudHandDigest,
  validHudProfile,
  type HudHandRecord,
  type OpponentHudProfile,
} from './OpponentHudProfile.js';
import {
  buildHudPacket,
  clearDecisionHud,
  hudCbetRaiseRecord,
  hudFirstWagerRaisedRecord,
  hudBarrelRecord,
  hudFirstWagerRecord,
  hudFirstWagerSizeCounts,
  hudLifetimeCount,
  hudStat,
  installDecisionHud,
} from './OpponentHud.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = 1_800_000_000_000;
type A = { seat: number; stage: string; action: string; amount: number };
let nextId = 1;
function rowOf(seats: number, acts: A[], at = T0 + nextId * 1000, family = 'plo5') {
  return {
    id: H(nextId++),
    created_at: new Date(at).toISOString(),
    game_variant: family,
    tournament_id: null,
    big_blind: 2,
    button_seat: seats,
    players: Array.from({ length: seats }, (_, i) => ({
      seat: i + 1,
      userId: U(i + 1),
      stack: 10_000,
    })),
    actions: acts.map((a) => ({ ...a, userId: U(a.seat) })),
    community_cards: ['Ah', '7d', '2c', '9s', '3h'],
    showdown: [],
    winners: [],
  };
}
const rec = (r: unknown) => {
  const x = handRecordFromRow(r);
  if (typeof x === 'string') throw new Error(x);
  return x;
};
/** preflop to a pot of exactly 1,000 (two players) or 1,500 (three); `pfa` made the last preflop raise */
function preflop(players: 2 | 3, pfa: number): A[] {
  const a: A[] = [
    { seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
    { seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
  ];
  a.push({ seat: pfa, stage: 'preflop', action: 'raise', amount: 500 });
  for (let s = 1; s <= players; s++)
    if (s !== pfa)
      a.push({
        seat: s,
        stage: 'preflop',
        action: 'call',
        amount: s === 1 ? 499 : s === 2 ? 498 : 500,
      });
  return a;
}
const xcOf = (r: unknown, user: number): Record<string, number> =>
  Object.fromEntries(extractHandDeltas(rec(r)).find((d) => d.user === U(user))!.xc ?? []);
function profileOf(user: number, rows: unknown[]): OpponentHudProfile {
  const p = emptyHudProfile(U(user), 'plo5');
  for (const r of rows) applyHudHand(p, rec(r));
  return p;
}
afterEach(() => clearDecisionHud());

describe('exact counters: registry', () => {
  it('168 first-wager bins, 24 raise answers, 40 continuation-bet answers; none is a blended statistic', () => {
    expect(HUD_FW_BINS).toBe(14);
    expect(HUD_EXACT_COUNTERS.filter((k) => /\.fw\./.test(k)).length).toBe(168);
    expect(HUD_EXACT_COUNTERS.filter((k) => /\.fwr\./.test(k)).length).toBe(24);
    expect(HUD_EXACT_COUNTERS.filter((k) => /^f\.cbr\./.test(k)).length).toBe(40);
    expect(HUD_EXACT_COUNTERS.filter((k) => /\.brl\./.test(k)).length).toBe(12);
    expect(new Set(HUD_EXACT_COUNTERS).size).toBe(244);
    for (const k of HUD_EXACT_COUNTERS) expect(HUD_STATS).not.toContain(k);
    expect(HUD_STATS.length).toBe(177); // 162 + the 15 added for the priced replacements, none of them a counter here
  });
  it("the bin edges are CORE-EXTEND-2's 'fw1' grid, upper edge inclusive; a pot-size wager is bin 11", () => {
    expect([...HUD_FW_EDGES]).toEqual([
      0.2, 0.232, 0.269, 0.312, 0.362, 0.42, 0.487, 0.565, 0.656, 0.761, 0.882, 1.024, 1.187,
    ]);
    expect(hudFwBin(0.05)).toBe(0);
    expect(hudFwBin(0.2)).toBe(0);
    expect(hudFwBin(0.2001)).toBe(1);
    expect(hudFwBin(1)).toBe(11);
    expect(hudFwBin(1.024)).toBe(11);
    expect(hudFwBin(1.187)).toBe(12);
    expect(hudFwBin(1.1871)).toBe(13);
    expect(hudFwBin(7)).toBe(13);
    // geometric, step 1.16 (edges rounded to three places): two whole steps fit in a window of x0.85..x1.15, so
    // at least one whole bin always lies inside it
    for (let i = 1; i < HUD_FW_EDGES.length; i++)
      expect(HUD_FW_EDGES[i] / HUD_FW_EDGES[i - 1]).toBeLessThanOrEqual(1.162);
    for (let i = 2; i < HUD_FW_EDGES.length; i++)
      expect(HUD_FW_EDGES[i] / HUD_FW_EDGES[i - 2]).toBeLessThan(1.15 / 0.85);
    expect([0.39, 0.4, 0.59, 0.6, 0.84, 0.85, 3].map(hudCbrSize)).toEqual([
      'small',
      'half',
      'half',
      'twothirds',
      'twothirds',
      'pot',
      'pot',
    ]);
  });
});

describe('exact counters: the size of the first wager, pinned cell by cell', () => {
  const STREETS = ['flop', 'turn', 'river'] as const;
  /** hero (seat 2) makes the street's first wager of `amount`; stab = seat 1 checked to him, lead = he acts first */
  function firstWagerHand(
    street: (typeof STREETS)[number],
    line: 'stab' | 'lead',
    players: 2 | 3,
    amount: number
  ) {
    const acts = preflop(players, 1);
    for (const st of STREETS) {
      if (st === street) {
        if (line === 'stab') acts.push({ seat: 1, stage: st, action: 'check', amount: 0 });
        acts.push({ seat: 2, stage: st, action: 'bet', amount });
        break;
      }
      for (let s = 1; s <= players; s++)
        acts.push({ seat: s, stage: st, action: 'check', amount: 0 });
    }
    return rowOf(players, acts);
  }
  it('every one of the 168 cells: the wager at each bin upper edge lands in that bin, one above it in the next', () => {
    const seen = new Set<string>();
    for (const street of STREETS)
      for (const line of ['stab', 'lead'] as const)
        for (const players of [2, 3] as const) {
          const pot = players === 2 ? 1000 : 1500;
          for (let bin = 0; bin < HUD_FW_BINS; bin++) {
            const amount = bin < 13 ? HUD_FW_EDGES[bin] * pot : HUD_FW_EDGES[12] * pot + 1;
            const key = `${street[0]}.fw.${line}.${players === 2 ? 'hu' : 'mw'}.b${String(bin).padStart(2, '0')}`;
            expect(xcOf(firstWagerHand(street, line, players, amount), 2)).toEqual({ [key]: 1 });
            seen.add(key);
            if (bin < 13) {
              const above = xcOf(firstWagerHand(street, line, players, amount + 1), 2);
              expect(Object.keys(above)).toEqual([
                key.replace(/b\d\d$/, `b${String(bin + 1).padStart(2, '0')}`),
              ]);
            }
          }
        }
    expect([...seen].sort()).toEqual(HUD_EXACT_COUNTERS.filter((k) => /\.fw\./.test(k)).sort());
  });
  it('the fraction is the wager over the pot before it, uncapped: an all-in of five pots is the top bin', () => {
    const acts = preflop(2, 1);
    acts.push({ seat: 1, stage: 'flop', action: 'check', amount: 0 });
    acts.push({ seat: 2, stage: 'flop', action: 'all_in', amount: 5000 });
    expect(xcOf(rowOf(2, acts), 2)).toEqual({ 'f.fw.stab.hu.b13': 1 });
  });
  it('only the FIRST wager of the street is binned: a raise, a second bet after a check-raise and a call are not', () => {
    const acts = preflop(3, 3);
    acts.push(
      { seat: 1, stage: 'flop', action: 'check', amount: 0 },
      { seat: 2, stage: 'flop', action: 'bet', amount: 750 }, // stab, half pot of 1,500: bin 7 (0.487, 0.565]
      { seat: 3, stage: 'flop', action: 'raise', amount: 2400 },
      { seat: 1, stage: 'flop', action: 'fold', amount: 0 },
      { seat: 2, stage: 'flop', action: 'call', amount: 1650 }
    );
    const r = rowOf(3, acts);
    expect(xcOf(r, 2)).toEqual({ 'f.fw.stab.mw.b07': 1, 'f.fwr.hu.opps': 1, 'f.fwr.hu.call': 1 });
    expect(xcOf(r, 3)).toEqual({}); // the raiser made no first wager and faced no continuation bet
    expect(xcOf(r, 1)).toEqual({});
  });
  it('the reader: bins, bets and opportunities by line; lines summed when none is named; other cells untouched', () => {
    const rows = [
      firstWagerHand('turn', 'stab', 2, 330), // b04
      firstWagerHand('turn', 'stab', 2, 1000), // b11
      firstWagerHand('turn', 'lead', 2, 1000), // b11
      firstWagerHand('river', 'stab', 2, 500), // turn: he checked (an unopened turn opportunity without a wager)
    ];
    installDecisionHud(buildHudPacket('plo5', [profileOf(2, rows)], {}, T0 + 1e7, 'turn'));
    const stab = hudFirstWagerSizeCounts(U(2), 'plo5', {
      street: 'turn',
      players: 'hu',
      line: 'stab',
    })!;
    expect(stab.edges).toBe('fw1');
    expect(stab.bins).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(stab.bets).toBe(2);
    const both = hudFirstWagerSizeCounts(U(2), 'plo5', { street: 'turn', players: 'hu' })!;
    expect(both.bins[11]).toBe(2);
    expect(both.bets).toBe(3);
    // the denominator is the existing unopened-opportunity count of the same cells
    const st = hudLifetimeCount(U(2), 'plo5', 'x.stab', { street: 'turn', players: 'hu' });
    const ld = hudLifetimeCount(U(2), 'plo5', 'x.lead', { street: 'turn', players: 'hu' });
    expect(both.opps).toBe(st.n + ld.n);
    expect(both.bets).toBe(st.hits + ld.hits);
    expect(hudFirstWagerSizeCounts(U(2), 'plo5', { street: 'turn', players: 'mw' })!.bets).toBe(0);
    // a street's counters ride in that street's packet only
    expect(hudFirstWagerSizeCounts(U(2), 'plo5', { street: 'river', players: 'hu' })!.bets).toBe(0);
    installDecisionHud(buildHudPacket('plo5', [profileOf(2, rows)], {}, T0 + 1e7, 'river'));
    expect(hudFirstWagerSizeCounts(U(2), 'plo5', { street: 'river', players: 'hu' })!.bins[7]).toBe(
      1
    );
  });
});

describe('exact counters: the first bettor facing a raise', () => {
  it.each([
    ['fold', { seat: 2, action: 'fold', amount: 0 }],
    ['call', { seat: 2, action: 'call', amount: 1500 }],
    ['raise', { seat: 2, action: 'raise', amount: 6000 }],
  ] as const)(
    'his %s is counted once on each of the three streets, by players at his answer',
    (answer, act) => {
      for (const [street, sk] of [
        ['flop', 'f'],
        ['turn', 't'],
        ['river', 'r'],
      ] as const) {
        const acts = preflop(2, 1);
        for (const st of ['flop', 'turn', 'river'] as const) {
          if (st !== street) {
            acts.push(
              { seat: 1, stage: st, action: 'check', amount: 0 },
              { seat: 2, stage: st, action: 'check', amount: 0 }
            );
            continue;
          }
          acts.push(
            { seat: 2, stage: st, action: 'bet', amount: 500 },
            { seat: 1, stage: st, action: 'raise', amount: 2000 },
            { ...act, stage: st }
          );
          break;
        }
        const r = rowOf(2, acts);
        const mine = xcOf(r, 2);
        expect(mine[`${sk}.fwr.hu.opps`]).toBe(1);
        expect(mine[`${sk}.fwr.hu.${answer}`]).toBe(1);
        installDecisionHud(buildHudPacket('plo5', [profileOf(2, [r])], {}, T0 + 1e7, street));
        expect(hudFirstWagerRaisedRecord(U(2), 'plo5', { street, players: 'hu' })).toEqual({
          opps: 1,
          fold: answer === 'fold' ? 1 : 0,
          call: answer === 'call' ? 1 : 0,
          raise: answer === 'raise' ? 1 : 0,
        });
        expect(hudFirstWagerRaisedRecord(U(2), 'plo5', { street, players: 'mw' })!.opps).toBe(0);
      }
    }
  );
});

describe('exact counters: facing a flop continuation bet', () => {
  it('every seat that answers the bet while it is the only flop wager, checked first or not; nothing after the first raise', () => {
    const acts = preflop(3, 3); // seat 3 raised last preflop
    acts.push(
      { seat: 1, stage: 'flop', action: 'check', amount: 0 },
      { seat: 2, stage: 'flop', action: 'check', amount: 0 },
      { seat: 3, stage: 'flop', action: 'bet', amount: 750 }, // half pot: 'half'
      { seat: 1, stage: 'flop', action: 'call', amount: 750 },
      { seat: 2, stage: 'flop', action: 'raise', amount: 3000 },
      { seat: 3, stage: 'flop', action: 'fold', amount: 0 },
      { seat: 1, stage: 'flop', action: 'fold', amount: 0 } // faces a raise, not a continuation bet
    );
    const r = rowOf(3, acts);
    expect(xcOf(r, 1)).toEqual({ 'f.cbr.mw.half.opps': 1, 'f.cbr.mw.half.call': 1 });
    expect(xcOf(r, 2)).toEqual({ 'f.cbr.mw.half.opps': 1, 'f.cbr.mw.half.raise': 1 });
    expect(xcOf(r, 3)).toEqual({
      'f.fw.stab.mw.b07': 1,
      'f.fwr.mw.opps': 1,
      'f.fwr.mw.fold': 1,
      'f.brl.mw.opps': 1, // he made the last preflop raise and the flop was unopened at his turn
      'f.brl.mw.bets': 1,
    });
  });
  it('no event: a limped pot; a flop first wager by anyone but the last preflop raiser', () => {
    const limp: A[] = [
      { seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
      { seat: 1, stage: 'preflop', action: 'call', amount: 1 },
      { seat: 2, stage: 'preflop', action: 'check', amount: 0 },
      { seat: 1, stage: 'flop', action: 'bet', amount: 4 },
      { seat: 2, stage: 'flop', action: 'call', amount: 4 },
    ];
    expect(Object.keys(xcOf(rowOf(2, limp), 2)).some((k) => k.includes('cbr'))).toBe(false);
    const donk = preflop(2, 1);
    donk.push(
      { seat: 2, stage: 'flop', action: 'bet', amount: 500 },
      { seat: 1, stage: 'flop', action: 'call', amount: 500 }
    );
    const r = rowOf(2, donk);
    expect(Object.keys({ ...xcOf(r, 1), ...xcOf(r, 2) }).some((k) => k.includes('cbr'))).toBe(
      false
    );
  });
  it('players and size: heads-up by the players live at his answer; the four sizes of the bet over the pot before it', () => {
    const rows: unknown[] = [];
    for (const [amount, size] of [
      [399, 'small'],
      [400, 'half'],
      [599, 'half'],
      [600, 'twothirds'],
      [849, 'twothirds'],
      [850, 'pot'],
    ] as const) {
      const acts = preflop(2, 1);
      acts.push(
        { seat: 1, stage: 'flop', action: 'bet', amount },
        { seat: 2, stage: 'flop', action: 'fold', amount: 0 }
      );
      const r = rowOf(2, acts);
      expect(xcOf(r, 2)).toEqual({ [`f.cbr.hu.${size}.opps`]: 1, [`f.cbr.hu.${size}.fold`]: 1 });
      rows.push(r);
    }
    // three to the flop, one folds to the bet: the last to answer is heads-up
    const acts = preflop(3, 1);
    acts.push(
      { seat: 1, stage: 'flop', action: 'bet', amount: 1500 },
      { seat: 2, stage: 'flop', action: 'fold', amount: 0 },
      { seat: 3, stage: 'flop', action: 'all_in', amount: 9500 }
    );
    const r3 = rowOf(3, acts);
    expect(xcOf(r3, 2)).toEqual({ 'f.cbr.mw.pot.opps': 1, 'f.cbr.mw.pot.fold': 1 });
    expect(xcOf(r3, 3)).toEqual({ 'f.cbr.hu.pot.opps': 1, 'f.cbr.hu.pot.raise': 1 });
    installDecisionHud(buildHudPacket('plo5', [profileOf(2, [...rows, r3])], {}, T0 + 1e7, 'flop'));
    const hu = hudCbetRaiseRecord(U(2), 'plo5', 'hu')!;
    expect([hu.opps, hu.folds, hu.calls, hu.raises]).toEqual([6, 6, 0, 0]);
    expect(HUD_CBR_SIZES.map((z) => hu.bySize[z].opps)).toEqual([1, 2, 2, 1]);
    expect(hudCbetRaiseRecord(U(2), 'plo5', 'mw')!.opps).toBe(1);
  });
  it('an all-in that does not exceed the bet is kept apart: a raise for the option (as its recorder counts it), not a wager above the bet', () => {
    const acts = preflop(2, 1);
    acts.push(
      { seat: 1, stage: 'flop', action: 'bet', amount: 1000 },
      { seat: 2, stage: 'flop', action: 'all_in', amount: 700 }
    );
    const r = rowOf(2, acts);
    expect(xcOf(r, 2)).toEqual({ 'f.cbr.hu.pot.opps': 1, 'f.cbr.hu.pot.shortAllIn': 1 });
    installDecisionHud(buildHudPacket('plo5', [profileOf(2, [r])], {}, T0 + 1e7, 'flop'));
    const c = hudCbetRaiseRecord(U(2), 'plo5', 'hu')!;
    expect([c.opps, c.raises, c.raisesAboveBet, c.shortAllIns]).toEqual([1, 1, 0, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// generated hands: invariants, and equality with the bench recorder
// ---------------------------------------------------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
interface Ev {
  stage: string;
  action: string;
  seatIdx: number;
  liveBefore: number;
}
function generated(seed: number, n: number) {
  const r = rng(seed);
  const out: { row: ReturnType<typeof rowOf>; events: Ev[]; short: boolean }[] = [];
  for (let h = 0; h < n; h++) {
    const N = 2 + Math.floor(r() * 3);
    const stack = Array.from({ length: N + 1 }, () => 60 + Math.floor(r() * 1500));
    const folded = new Array<boolean>(N + 1).fill(false);
    const committed = new Array<number>(N + 1).fill(0);
    const acts: A[] = [];
    const events: Ev[] = [];
    let short = false;
    let pot = 0;
    const post = (seat: number, action: string, amount: number) => {
      acts.push({ seat, stage: 'preflop', action, amount });
      committed[seat] = amount;
      stack[seat] -= amount;
      pot += amount;
    };
    post(1, 'sb', 1);
    post(2, 'bb', 2);
    let stop = false;
    for (const stage of ['preflop', 'flop', 'turn', 'river']) {
      if (stop) break;
      let bet = stage === 'preflop' ? 2 : 0;
      if (stage !== 'preflop') committed.fill(0);
      const order = Array.from(
        { length: N },
        (_, i) => ((i + (stage === 'preflop' ? 2 : 0)) % N) + 1
      );
      let pending = order.filter((s) => !folded[s] && stack[s] > 0);
      if (pending.length < 2 && !(stage === 'preflop')) break;
      let guard = 0;
      while (pending.length && guard++ < 40) {
        const seat = pending.shift()!;
        if (folded[seat] || stack[seat] <= 0) continue;
        const live = folded.slice(1).filter((f) => !f).length;
        if (live < 2) break;
        const toCall = bet - committed[seat];
        const x = r();
        let action: string;
        let amount = 0;
        let total = committed[seat];
        if (toCall <= 0) {
          if (x < 0.5) action = 'check';
          else if (x < 0.93) {
            const size = Math.max(2, Math.round(pot * (0.15 + r() * 1.3)));
            if (size >= stack[seat]) {
              action = 'all_in';
              total = committed[seat] + stack[seat];
            } else {
              action = stage === 'preflop' ? 'raise' : 'bet';
              total = committed[seat] + size;
            }
            amount = total;
          } else {
            action = 'all_in';
            total = committed[seat] + stack[seat];
            amount = total;
          }
        } else if (x < 0.33) action = 'fold';
        else if (x < 0.72) {
          if (stack[seat] <= toCall) {
            action = 'all_in';
            total = committed[seat] + stack[seat];
            amount = total;
          } else {
            action = 'call';
            amount = toCall;
            total = bet;
          }
        } else if (x < 0.95) {
          const to = bet + Math.max(2, Math.round((pot + toCall) * (0.4 + r())));
          if (to - committed[seat] >= stack[seat]) {
            action = 'all_in';
            total = committed[seat] + stack[seat];
          } else {
            action = 'raise';
            total = to;
          }
          amount = total;
        } else {
          action = 'all_in';
          total = committed[seat] + stack[seat];
          amount = total;
        }
        if (action === 'all_in' && total <= bet) short = true;
        events.push({ stage, action, seatIdx: seat, liveBefore: live });
        acts.push({ seat, stage, action, amount });
        if (action === 'fold') folded[seat] = true;
        const paid = total - committed[seat];
        stack[seat] -= paid;
        pot += paid;
        committed[seat] = total;
        if (total > bet) {
          bet = total;
          pending = order
            .slice(order.indexOf(seat) + 1)
            .concat(order.slice(0, order.indexOf(seat)))
            .filter((s) => !folded[s] && stack[s] > 0);
        }
      }
      if (folded.slice(1).filter((f) => !f).length < 2) stop = true;
      if (order.filter((s) => !folded[s] && stack[s] > 0).length < 2) stop = true;
    }
    out.push({ row: rowOf(N, acts), events, short });
  }
  return out;
}
/** cbRecObserver of the bench (cbet-defence SparringLeague.ts lines 1022-1064), line for line */
function benchRecorder(hands: { events: Ev[] }[]) {
  const recd = new Map<
    string,
    { hu: { opps: number; raises: number }; mw: { opps: number; raises: number } }
  >();
  for (const h of hands) {
    let stage = 'preflop';
    let pfa = -1;
    let cur = -1;
    let sw = 0;
    let cbSeat = -1;
    let done = false;
    const pend: { id: string; k: 'hu' | 'mw'; raise: boolean }[] = [];
    for (const e of h.events) {
      if (e.stage !== stage) {
        if (stage === 'preflop') pfa = cur;
        stage = e.stage;
        sw = 0;
      }
      const ag = e.action === 'bet' || e.action === 'raise' || e.action === 'all_in';
      if (e.stage === 'flop') {
        if (sw === 0 && ag && e.seatIdx === pfa) cbSeat = e.seatIdx;
        else if (sw === 1 && cbSeat >= 0 && !done && e.seatIdx !== cbSeat) {
          pend.push({ id: U(e.seatIdx), k: e.liveBefore <= 2 ? 'hu' : 'mw', raise: ag });
          if (ag) done = true;
        }
      }
      if (ag) {
        sw++;
        cur = e.seatIdx;
      }
    }
    for (const x of pend) {
      const c = recd.get(x.id) ?? { hu: { opps: 0, raises: 0 }, mw: { opps: 0, raises: 0 } };
      c[x.k].opps++;
      if (x.raise) c[x.k].raises++;
      recd.set(x.id, c);
    }
  }
  return recd;
}

describe('exact counters on generated hands', () => {
  const hands = generated(20261121, 4000);
  const profiles = new Map<string, OpponentHudProfile>();
  for (const h of hands) {
    const hr = rec(h.row) as HudHandRecord;
    const deltas = extractHandDeltas(hr);
    for (const s of hr.seats) {
      let p = profiles.get(s.userId);
      if (!p) profiles.set(s.userId, (p = emptyHudProfile(s.userId, 'plo5')));
      applyHudHand(p, hr, deltas);
    }
  }
  it("the bins of a cell sum to the cell's bets, for every seat of every hand and in every lifetime profile", () => {
    let wagers = 0;
    for (const h of hands) {
      for (const d of extractHandDeltas(rec(h.row))) {
        for (const s of ['f', 't', 'r'])
          for (const ln of ['stab', 'lead'])
            for (const pl of ['hu', 'mw']) {
              let sum = 0;
              for (let i = 0; i < HUD_FW_BINS; i++)
                sum += d.xc?.get(`${s}.fw.${ln}.${pl}.b${String(i).padStart(2, '0')}`) ?? 0;
              expect(sum).toBe(d.stats.get(`${s}.${ln}.${pl}`)?.[1] ?? 0);
              wagers += sum;
            }
        for (const [k, v] of d.xc ?? []) {
          expect(HUD_EXACT_COUNTERS).toContain(k);
          if (k.includes('.brl.')) {
            if (k.endsWith('.bets'))
              expect(v).toBeLessThanOrEqual(d.xc!.get(k.replace(/bets$/, 'opps')) ?? 0);
          } else if (k.endsWith('.opps')) {
            const base = k.slice(0, -5);
            const answers = ['fold', 'call', 'raise', 'shortAllIn'].reduce(
              (a, x) => a + (d.xc!.get(`${base}.${x}`) ?? 0),
              0
            );
            expect(answers).toBe(v);
          }
        }
      }
    }
    expect(wagers).toBeGreaterThan(2000);
    for (const p of profiles.values()) {
      expect(validHudProfile(JSON.parse(JSON.stringify(p)))).toBe(true);
      for (const s of ['f', 't', 'r'])
        for (const ln of ['stab', 'lead'])
          for (const pl of ['hu', 'mw']) {
            let sum = 0;
            for (let i = 0; i < HUD_FW_BINS; i++)
              sum += p.xc![`${s}.fw.${ln}.${pl}.b${String(i).padStart(2, '0')}`] ?? 0;
            expect(sum).toBe(p.life[`${s}.${ln}.${pl}`]?.[1] ?? 0);
          }
    }
  });
  it('EQUALITY LAW: the continuation-bet counts equal the bench recorder row for row on hands without a short all-in', () => {
    const clean = hands.filter((h) => !h.short);
    expect(clean.length).toBeGreaterThan(2500);
    const want = benchRecorder(clean);
    const got = new Map<
      string,
      { hu: { opps: number; raises: number }; mw: { opps: number; raises: number } }
    >();
    for (const h of clean)
      for (const d of extractHandDeltas(rec(h.row)))
        for (const [k, v] of d.xc ?? []) {
          const m = /^f\.cbr\.(hu|mw)\.[a-z]+\.(opps|raise|shortAllIn)$/.exec(k);
          if (!m) continue;
          const c = got.get(d.user) ?? { hu: { opps: 0, raises: 0 }, mw: { opps: 0, raises: 0 } };
          if (m[2] === 'opps') c[m[1] as 'hu' | 'mw'].opps += v;
          else c[m[1] as 'hu' | 'mw'].raises += v;
          got.set(d.user, c);
        }
    expect(Object.fromEntries([...got].sort())).toEqual(Object.fromEntries([...want].sort()));
    const total = [...want.values()].reduce((a, c) => a + c.hu.opps + c.mw.opps, 0);
    const raises = [...want.values()].reduce((a, c) => a + c.hu.raises + c.mw.raises, 0);
    expect(total).toBeGreaterThan(300);
    expect(raises).toBeGreaterThan(40);
  });
  it('where the recorder and the written definition part (a short all-in), the counts are those of the definition', () => {
    // preflop: a short all-in after the last raise is not the last preflop raiser (spec 1; the engine's line test)
    const acts: A[] = [
      { seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
      { seat: 3, stage: 'preflop', action: 'raise', amount: 500 },
      { seat: 4, stage: 'preflop', action: 'all_in', amount: 300 },
      { seat: 1, stage: 'preflop', action: 'call', amount: 499 },
      { seat: 2, stage: 'preflop', action: 'fold', amount: 0 },
      { seat: 1, stage: 'flop', action: 'check', amount: 0 },
      { seat: 3, stage: 'flop', action: 'bet', amount: 600 },
      { seat: 1, stage: 'flop', action: 'fold', amount: 0 },
    ];
    const r = rowOf(4, acts);
    const mine = xcOf(r, 1);
    expect(Object.keys(mine).filter((k) => k.endsWith('.opps'))).toEqual(['f.cbr.mw.half.opps']);
    expect(mine['f.cbr.mw.half.fold']).toBe(1);
  });
  it('each hand once in any order: twice changes nothing, reversed order gives the same counters, the digest covers them', () => {
    const some = hands
      .slice(0, 300)
      .map((h) => rec(h.row) as HudHandRecord)
      .filter((h) => h.seats.some((s) => s.userId === U(1)));
    const fwd = emptyHudProfile(U(1), 'plo5');
    const rev = emptyHudProfile(U(1), 'plo5');
    for (const h of some) applyHudHand(fwd, h);
    for (const h of some) expect(applyHudHand(fwd, h)).toBe('duplicate');
    for (const h of [...some].reverse()) applyHudHand(rev, h);
    expect(rev.xc).toEqual(fwd.xc);
    expect(Object.keys(fwd.xc!).length).toBeGreaterThan(10);
    const withX = some.find(
      (h) => (extractHandDeltas(h).find((d) => d.user === U(1))?.xc?.size ?? 0) > 0
    )!;
    const deltas = extractHandDeltas(withX);
    const stripped = deltas.map((d) => ({ ...d, xc: undefined }));
    expect(hudHandDigest(U(1), withX, deltas)).not.toBe(hudHandDigest(U(1), withX, stripped));
  });
});

describe('exact counters are ADDITIVE', () => {
  const hands = generated(7, 600).map((h) => rec(h.row) as HudHandRecord);
  const withX = emptyHudProfile(U(1), 'plo5');
  const before = emptyHudProfile(U(1), 'plo5');
  delete before.xc; // a profile built before the counters existed
  for (const h of hands) {
    applyHudHand(withX, h);
    applyHudHand(before, h);
  }
  it('a profile built before the counters existed never gains them and reads as null, not zeros', () => {
    expect(before.xc).toBeUndefined();
    expect(before.hands).toBe(withX.hands);
    expect(validHudProfile(JSON.parse(JSON.stringify(before)))).toBe(true);
    installDecisionHud(buildHudPacket('plo5', [before], {}, T0 + 1e7, 'flop'));
    expect(hudFirstWagerSizeCounts(U(1), 'plo5', { street: 'flop', players: 'hu' })).toBeNull();
    expect(hudFirstWagerRaisedRecord(U(1), 'plo5', { street: 'flop', players: 'hu' })).toBeNull();
    expect(hudCbetRaiseRecord(U(1), 'plo5', 'hu')).toBeNull();
    expect(hudFirstWagerSizeCounts(U(99), 'plo5', { street: 'flop', players: 'hu' })).toBeNull(); // no profile
    clearDecisionHud();
    expect(hudFirstWagerSizeCounts(U(1), 'plo5', { street: 'flop', players: 'hu' })).toBeNull(); // no packet
  });
  it('every existing part of the profile and the packet is identical with and without them', () => {
    const { xc: _a, ...p1 } = withX;
    const { xc: _b, ...p0 } = before;
    expect(p1).toEqual(p0);
    for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
      const a = buildHudPacket('plo5', [withX], {}, T0 + 1e7, street);
      const b = buildHudPacket('plo5', [before], {}, T0 + 1e7, street);
      const { xc, ...rest } = a.opp[U(1)];
      expect(rest).toEqual(b.opp[U(1)]);
      expect(xc === undefined).toBe(street === 'preflop');
      for (const k of Object.keys(xc ?? {})) expect(k.startsWith(`${street[0]}.`)).toBe(true);
      installDecisionHud(a);
      const ra = [
        hudStat(U(1), 'plo5', 'f.fBet'),
        hudLifetimeCount(U(1), 'plo5', 'x.stab', { street: 'flop', players: 'hu' }),
        hudFirstWagerRecord(U(1), 'plo5', 'flop', 'hu'),
      ];
      installDecisionHud(b);
      expect([
        hudStat(U(1), 'plo5', 'f.fBet'),
        hudLifetimeCount(U(1), 'plo5', 'x.stab', { street: 'flop', players: 'hu' }),
        hudFirstWagerRecord(U(1), 'plo5', 'flop', 'hu'),
      ]).toEqual(ra);
    }
  });
});

describe('the barrel record has one counter and two readers (STAB-DEFENCE-7; lead 4:02 AM Nov 21)', () => {
  const hands = generated(11, 1500).map((h) => rec(h.row) as HudHandRecord);
  const withX = emptyHudProfile(U(1), 'plo5');
  const before = emptyHudProfile(U(1), 'plo5');
  delete before.xc;
  for (const h of hands) {
    applyHudHand(withX, h);
    applyHudHand(before, h);
  }
  it('hudBarrelRecord and hudFirstWagerRecord().afterOwnWager are the same exact counts, a part of the same opportunities', () => {
    let opps = 0;
    for (const [street, sk] of [
      ['turn', 't'],
      ['river', 'r'],
    ] as const) {
      installDecisionHud(buildHudPacket('plo5', [withX], {}, T0 + 1e7, street));
      for (const players of ['hu', 'mw'] as const) {
        const want = {
          opps: withX.xc![`${sk}.brl.${players}.opps`] ?? 0,
          bets: withX.xc![`${sk}.brl.${players}.bets`] ?? 0,
        };
        expect(hudBarrelRecord(U(1), 'plo5', { street, players })).toEqual(want);
        const fw = hudFirstWagerRecord(U(1), 'plo5', street, players)!;
        expect(fw.afterOwnWager).toEqual(want);
        expect(want.bets).toBeLessThanOrEqual(want.opps);
        expect(want.opps).toBeLessThanOrEqual(fw.opps);
        expect(want.bets).toBeLessThanOrEqual(fw.bets);
        opps += want.opps;
      }
    }
    expect(opps).toBeGreaterThan(20); // not an empty law
    clearDecisionHud();
  });
  it('unknown is absent, never zeros, and every other field of the record is what it was', () => {
    for (const street of ['turn', 'river'] as const) {
      for (const players of ['hu', 'mw'] as const) {
        installDecisionHud(buildHudPacket('plo5', [withX], {}, T0 + 1e7, street));
        const { afterOwnWager, ...rest } = hudFirstWagerRecord(U(1), 'plo5', street, players)!;
        expect(afterOwnWager).toBeDefined();
        installDecisionHud(buildHudPacket('plo5', [before], {}, T0 + 1e7, street));
        const old = hudFirstWagerRecord(U(1), 'plo5', street, players)!;
        expect('afterOwnWager' in old).toBe(false);
        expect(old).toEqual(rest);
        expect(hudBarrelRecord(U(1), 'plo5', { street, players })).toBeNull();
      }
    }
    installDecisionHud(buildHudPacket('plo5', [withX], {}, T0 + 1e7, 'flop'));
    expect('afterOwnWager' in hudFirstWagerRecord(U(1), 'plo5', 'flop', 'hu')!).toBe(false);
    clearDecisionHud();
    expect(hudBarrelRecord(U(1), 'plo5', { street: 'turn', players: 'hu' })).toBeNull();
  });
});
