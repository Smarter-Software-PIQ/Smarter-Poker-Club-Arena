/**
 * PERSONA RE-RAISE MIX (D3 option C, option holdemPersonaReRaiseMix, default
 * OFF): persona-specific 3-bet bluffs, squeeze bluffs and 26-35bb four-bet
 * reshove bluffs in two-card no-limit hold'em.
 *
 *  (a) OFF is today's code: absent and false decide the same thing from the
 *      same draws as a control that says what "today" is without the option:
 *      the persona field injected at scale 1 with the consumed draw itself as
 *      the unit, which is `roll < p` by construction.
 *  (b) ON never reaches Omaha, short deck or fixed limit.
 *  (c) ON in hold'em consumes the same draws at the bluff sites, orders the
 *      archetypes LAG > TAG > Tricky > Nit and is a pure function of the
 *      Horse, the hand's public state and its cards.
 *  (d) The four-bet reshove's bluff classes shove at the Horse's scale; value
 *      classes always shove.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Card, SeatPlayer, ActionRecord } from '../types.js';

// The control of (a). Pass-through unless a test switches it on; then every
// preflop decision is made with the persona field present at scale 1 and the
// unit read back as the draw the site has just consumed, so the scaled
// comparison `u < min(1, p * 1)` is the unscaled `roll < p`, and the reshove
// unit 0 always shoves. Any difference from the option-off run is the off
// path not being today's expression, or the on path drawing differently.
const control = vi.hoisted(() => ({ on: false, unitReads: 0 }));
vi.mock('./HorsePreflop.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./HorsePreflop.js')>();
  return {
    ...actual,
    decidePreflopV7: (ctx: Parameters<typeof actual.decidePreflopV7>[0]) => {
      if (!control.on) return actual.decidePreflopV7(ctx);
      let last = Number.NaN;
      const unit = () => {
        control.unitReads++;
        return last;
      };
      return actual.decidePreflopV7({
        ...ctx,
        rand: () => (last = ctx.rand()),
        holdemPersonaReRaise: {
          scale: 1,
          get u3bet() {
            return unit();
          },
          get uSqueeze() {
            return unit();
          },
          uFourBet: 0,
        },
      });
    },
  };
});

import { seedFastRandom } from './HorseEval.js';
import { SUITS, RANKS } from './PokerEngine.js';
import { holdemPersonaFor, holdemPersonaReRaiseScale } from './HorsePersona.js';
import {
  decideArms,
  playProbeHand,
  probeRng,
  syntheticFleet,
  syntheticHorseId,
  type ProbeArm,
  type ProbeMode,
  type ProbeRead,
  type ProbeTable,
  type ProbeTableState,
  type ProbeVariant,
} from '../benchmark/HoldemPersonaReRaiseProbe.js';

const FLEET = syntheticFleet();
const ABSENT: ProbeArm = { opts: {} };
const FALSE: ProbeArm = { opts: { holdemPersonaReRaiseMix: false } };
const CONTROL: ProbeArm = {
  opts: {},
  around: (decide) => {
    control.on = true;
    try {
      return decide();
    } finally {
      control.on = false;
    }
  },
};
const OFF_T: ProbeArm = { opts: {}, telemetry: true };
const ON_T: ProbeArm = { opts: { holdemPersonaReRaiseMix: true }, telemetry: true };

const same = (a: ProbeRead, b: ProbeRead) =>
  a.action === b.action && a.amount === b.amount && a.rngAfter === b.rngAfter;
const personaFires = (r: ProbeRead) => r.fires.filter((f) => f.startsWith('holdem_persona_'));
const changed = (r: ProbeRead) => r.fires.some((f) => /^holdem_persona_.*_changed_seen$/.test(f));
const eligible = (r: ProbeRead) => r.fires.some((f) => /^holdem_persona_.*_eligible_seen$/.test(f));
const PRINT = process.env.PERSONA_RERAISE_PRINT === '1';

interface Run {
  name: string;
  variant: ProbeVariant;
  mode: ProbeMode;
  seats: number;
  depthBB: number | readonly [number, number];
  hands: number;
}
const RUNS: readonly Run[] = [
  { name: 'nlh cash', variant: 'nlh', mode: 'cash', seats: 6, depthBB: 100, hands: 150 },
  { name: 'nlh cash 30bb', variant: 'nlh', mode: 'cash', seats: 6, depthBB: [26, 35], hands: 150 },
  {
    name: 'nlh tournament',
    variant: 'nlh',
    mode: 'tournament',
    seats: 9,
    depthBB: [20, 40],
    hands: 110,
  },
  { name: 'plo4', variant: 'plo4', mode: 'cash', seats: 6, depthBB: 100, hands: 70 },
  { name: 'plo5', variant: 'plo5', mode: 'cash', seats: 6, depthBB: 100, hands: 70 },
  { name: 'plo6', variant: 'plo6', mode: 'cash', seats: 6, depthBB: 100, hands: 70 },
  { name: 'short deck', variant: 'short_deck', mode: 'cash', seats: 6, depthBB: 100, hands: 70 },
  { name: 'fixed limit', variant: 'flh', mode: 'cash', seats: 6, depthBB: 100, hands: 70 },
];

/** Play a run's hands; the table changes its six or nine ids every ten hands. */
function play(
  run: Run,
  index: number,
  arms: readonly ProbeArm[],
  onSpot: Parameters<typeof playProbeHand>[3]
): void {
  const r = probeRng(0x51ab + index * 7919);
  seedFastRandom((0x9e37 + index * 104729) >>> 0);
  for (let h = 0; h < run.hands; h++) {
    const from = ((index * 97 + Math.floor(h / 10) * run.seats) % (FLEET.length - run.seats)) | 0;
    const table: ProbeTable = {
      variant: run.variant,
      mode: run.mode,
      ids: FLEET.slice(from, from + run.seats),
      depthBB: run.depthBB,
    };
    playProbeHand(table, r, arms, onSpot);
  }
}

describe('persona re-raise mix: OFF is the code that runs today', () => {
  let total = 0;
  RUNS.forEach((run, index) =>
    it(`${run.name}: absent, false and the scale-1 control decide alike from the same draws`, () => {
      control.unitReads = 0;
      let decisions = 0;
      play(run, index, [ABSENT, FALSE, CONTROL], (spot) => {
        decisions++;
        const [absent, off, ctl] = spot.reads;
        if (!same(absent, off) || !same(absent, ctl))
          throw new Error(
            `${run.name} decision ${decisions}: absent ${JSON.stringify(absent)} false ${JSON.stringify(off)} control ${JSON.stringify(ctl)}`
          );
      });
      total += decisions;
      if (PRINT)
        console.log(
          `(a) ${run.name}: ${decisions} decisions, control unit reads ${control.unitReads}`
        );
      expect(decisions).toBeGreaterThan(run.hands * 4);
      // The control is not vacuous: the bluff sites read the injected unit.
      expect(control.unitReads).toBeGreaterThan(0);
    })
  );
  it('covers a few thousand decisions', () => {
    expect(total).toBeGreaterThan(3000);
  });
});

describe('persona re-raise mix: ON never reaches another variant', () => {
  RUNS.filter((run) => run.variant !== 'nlh').forEach((run, k) =>
    it(`${run.name}: decisions and draws equal the option off, and no persona receipt fires`, () => {
      let decisions = 0;
      play(run, 100 + k, [OFF_T, ON_T], (spot) => {
        decisions++;
        const [off, on] = spot.reads;
        expect(same(off, on), `${run.name} decision ${decisions}`).toBe(true);
        expect(personaFires(on)).toEqual([]);
      });
      expect(decisions).toBeGreaterThan(run.hands * 4);
    })
  );
});

// ── Direct spots: six-handed cash, the dealer in seat 6 ────────────────────
const BB = 0.1;
const c = (rank: string, suit: number): Card => ({ rank, suit: SUITS[suit] }) as Card;
const r2 = (x: number) => Math.round(x * 100) / 100;

function sixHandedSpot(
  kind: 'bb_faces_button_open' | 'button_faces_3bet',
  heroId: string,
  heroCards: Card[],
  depthBB: number
): { table: ProbeTable; st: ProbeTableState; heroSeat: number } {
  const heroSeat = kind === 'bb_faces_button_open' ? 2 : 6;
  const ids = Array.from({ length: 6 }, (_, i) =>
    i + 1 === heroSeat ? heroId : syntheticHorseId(900000 + i)
  );
  const taken = new Set(heroCards.map((x) => `${x.rank}${x.suit}`));
  const rest: Card[] = [];
  for (const s of SUITS)
    for (const rank of RANKS) if (!taken.has(`${rank}${s}`)) rest.push({ rank, suit: s } as Card);
  const bets =
    kind === 'bb_faces_button_open' ? [0.05, 0.1, 0, 0, 0, 0.25] : [0.05, 0.75, 0, 0, 0, 0.22];
  const folded = [true, false, true, true, true, false];
  const players: SeatPlayer[] = ids.map((id, i) => ({
    seat: i + 1,
    user_id: id,
    username: 'U' + (i + 1),
    stack: r2(depthBB * BB - bets[i]),
    bet: bets[i],
    totalInvested: bets[i],
    cards: i + 1 === heroSeat ? heroCards : rest.splice(0, 2),
    is_folded: folded[i],
    is_all_in: false,
    is_sitting_out: false,
  }));
  const acts: [number, 'fold' | 'raise', number][] =
    kind === 'bb_faces_button_open'
      ? [
          [3, 'fold', 0],
          [4, 'fold', 0],
          [5, 'fold', 0],
          [6, 'raise', 0.25],
          [1, 'fold', 0],
        ]
      : [
          [3, 'fold', 0],
          [4, 'fold', 0],
          [5, 'fold', 0],
          [6, 'raise', 0.22],
          [1, 'fold', 0],
          [2, 'raise', 0.75],
        ];
  const history = acts.map(
    ([seat, action, amount], i) =>
      ({
        seat,
        userId: ids[seat - 1],
        action,
        amount,
        timestamp: 1000 + i,
        stage: 'preflop',
      }) as ActionRecord
  );
  return {
    table: { variant: 'nlh', mode: 'cash', ids, depthBB },
    st: {
      players,
      history,
      currentBet: kind === 'bb_faces_button_open' ? 0.25 : 0.75,
      lastRaise: kind === 'bb_faces_button_open' ? 0.15 : 0.53,
      dealerSeat: 6,
      bb: BB,
      sb: 0.05,
    },
    heroSeat,
  };
}

function decideSpot(
  kind: Parameters<typeof sixHandedSpot>[0],
  heroId: string,
  cards: Card[],
  depthBB: number,
  seed: number,
  arms: readonly ProbeArm[]
): ProbeRead[] {
  const s = sixHandedSpot(kind, heroId, cards, depthBB);
  seedFastRandom(seed);
  return decideArms(s.table, s.st, s.heroSeat, arms);
}

const idsOf = (archetype: string, n: number, keep: (id: string) => boolean = () => true) =>
  FLEET.filter((id) => holdemPersonaFor(id).archetype === archetype && keep(id)).slice(0, n);

/** Big-blind hands that reach the 3-bet bluff comparison against a button open. */
function eligibleBluffSpots(want: number): { cards: Card[]; seed: number }[] {
  const r = probeRng(0xbeef);
  const out: { cards: Card[]; seed: number }[] = [];
  const probeId = idsOf('tag_crusher', 1)[0];
  for (let k = 0; out.length < want && k < 40000; k++) {
    const a = Math.floor(r() * 52);
    let b = Math.floor(r() * 51);
    if (b >= a) b++;
    const cards = [
      c(String(RANKS[a % 13]), Math.floor(a / 13)),
      c(String(RANKS[b % 13]), Math.floor(b / 13)),
    ];
    const seed = 0x1000 + k;
    const [on] = decideSpot('bb_faces_button_open', probeId, cards, 100, seed, [ON_T]);
    if (on.fires.includes('holdem_persona_3bet_bluff_eligible_seen')) out.push({ cards, seed });
  }
  return out;
}

describe("persona re-raise mix: ON in no-limit hold'em", () => {
  it('consumes the same draws at the bluff sites: a decision the persona did not change equals the option off, draw for draw', () => {
    let unchangedEligible = 0;
    let changedCount = 0;
    let actionMoved = 0;
    const reached = new Map<string, number>();
    RUNS.filter((run) => run.variant === 'nlh').forEach((run, k) =>
      play({ ...run, hands: run.hands * 4 }, 200 + k, [OFF_T, ON_T], (spot) => {
        const [off, on] = spot.reads;
        expect(personaFires(off)).toEqual([]);
        for (const f of personaFires(on))
          reached.set(`${run.mode} ${f}`, (reached.get(`${run.mode} ${f}`) ?? 0) + 1);
        if (changed(on)) {
          changedCount++;
          if (off.action !== on.action) actionMoved++;
          return;
        }
        if (eligible(on)) unchangedEligible++;
        if (!same(off, on))
          throw new Error(
            `${run.name}: unchanged decision differs: off ${JSON.stringify(off)} on ${JSON.stringify(on)}`
          );
      })
    );
    if (PRINT)
      console.log(
        '(c) unchanged eligible',
        unchangedEligible,
        'changed',
        changedCount,
        'action moved',
        actionMoved,
        Object.fromEntries(reached)
      );
    expect(unchangedEligible).toBeGreaterThan(100);
    expect(changedCount).toBeGreaterThan(20);
    expect(actionMoved).toBeGreaterThan(5);
    // All three behaviours were met: the 3-bet bluff, the squeeze bluff in
    // cash (the chart block) and in a tournament (the V7 squeeze site), and
    // the four-bet reshove.
    for (const key of [
      'cash holdem_persona_3bet_bluff_eligible_seen',
      'cash holdem_persona_squeeze_bluff_eligible_seen',
      'tournament holdem_persona_3bet_bluff_eligible_seen',
      'tournament holdem_persona_squeeze_bluff_eligible_seen',
      'cash holdem_persona_fourbet_reshove_eligible_seen',
    ])
      expect(reached.get(key) ?? 0, key).toBeGreaterThan(0);
  });

  const spots = eligibleBluffSpots(150);

  it('orders the archetypes LAG > TAG > Tricky > Nit over equal opportunities', () => {
    expect(spots.length).toBe(150);
    const rate: Record<string, number> = {};
    for (const archetype of ['lag_shark', 'tag_crusher', 'tricky_trap', 'nit_hunter']) {
      const ids = idsOf(archetype, 40);
      expect(ids.length).toBe(40);
      let e = 0;
      let t = 0;
      for (const id of ids)
        for (const spot of spots) {
          const [on] = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [ON_T]);
          if (on.fires.includes('holdem_persona_3bet_bluff_eligible_seen')) e++;
          if (on.bluffBranch) t++;
        }
      // Equal opportunities: the same spots are eligible for every Horse.
      expect(e).toBe(ids.length * spots.length);
      rate[archetype] = t / e;
    }
    if (PRINT) console.log('(c) 3-bet bluff rate over equal opportunities', rate);
    expect(rate.lag_shark).toBeGreaterThan(rate.tag_crusher);
    expect(rate.tag_crusher).toBeGreaterThan(rate.tricky_trap);
    expect(rate.tricky_trap).toBeGreaterThan(rate.nit_hunter);
    // The spread is the persona's: the loosest group bluffs well over the tightest.
    expect(rate.lag_shark / rate.nit_hunter).toBeGreaterThan(1.5);
  });

  it('is a pure function of the Horse, the hand and the cards: the same spot twice, and not constant across hands', () => {
    const id = idsOf('nit_hunter', 1)[0];
    for (const spot of spots.slice(0, 25)) {
      const a = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [ON_T])[0];
      const b = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [ON_T])[0];
      expect(b).toEqual(a);
    }
    // One Horse, one holding, one draw (the same seed): the option off gives
    // one answer at every stack depth; the persona's unit moves with the
    // hand's public state, so its answer does not stay put.
    let varied = 0;
    for (const spot of spots.slice(0, 25)) {
      const offSeen = new Set<boolean>();
      const onSeen = new Set<boolean>();
      for (let k = 0; k < 40; k++) {
        const [off, on] = decideSpot(
          'bb_faces_button_open',
          id,
          spot.cards,
          100 + k * 0.25,
          spot.seed,
          [OFF_T, ON_T]
        );
        if (!on.fires.includes('holdem_persona_3bet_bluff_eligible_seen')) continue;
        offSeen.add(off.bluffBranch);
        onSeen.add(on.bluffBranch);
      }
      expect(offSeen.size).toBeLessThanOrEqual(1);
      if (onSeen.size === 2) varied++;
    }
    expect(varied).toBeGreaterThan(10);
  });
});

describe('persona re-raise mix: the 26-35bb four-bet reshove', () => {
  const BLUFF: Card[][] = [];
  for (const low of ['5', '4', '3', '2'])
    for (let s = 0; s < 4; s++) BLUFF.push([c('A', s), c(low, s)]);
  const VALUE: Card[][] = [
    [c('A', 0), c('K', 1)],
    [c('A', 2), c('T', 2)],
    [c('K', 3), c('Q', 3)],
    [c('9', 0), c('9', 1)],
    [c('7', 2), c('7', 3)],
  ];
  const DEPTHS = [27, 30, 33];
  const low = idsOf('nit_hunter', 20);
  const high = idsOf('lag_shark', 20, (id) => holdemPersonaReRaiseScale(id) >= 1);

  it('today every bluff class and every value class shoves here (the premise)', () => {
    for (const depth of DEPTHS)
      for (const cards of [...BLUFF, ...VALUE]) {
        const [off] = decideSpot('button_faces_3bet', low[0], cards, depth, 77, [OFF_T]);
        expect(off.action, `${cards[0].rank}${cards[1].rank} at ${depth}bb`).toBe('all_in');
      }
  });

  it('a Horse at scale 1 or more always shoves A5s-A2s; a low-scale Horse sometimes does not', () => {
    expect(high.length).toBe(20);
    for (const id of high)
      for (const depth of DEPTHS)
        for (const cards of BLUFF) {
          const [on] = decideSpot('button_faces_3bet', id, cards, depth, 77, [ON_T]);
          expect(on.action).toBe('all_in');
          expect(on.fires).toContain('holdem_persona_fourbet_reshove_eligible_seen');
          expect(changed(on)).toBe(false);
        }
    let shoved = 0;
    let refused = 0;
    const instead = new Map<string, number>();
    for (const id of low) {
      expect(holdemPersonaReRaiseScale(id)).toBeLessThan(0.82);
      for (const depth of DEPTHS)
        for (const cards of BLUFF) {
          const [on] = decideSpot('button_faces_3bet', id, cards, depth, 77, [ON_T]);
          expect(on.fires).toContain('holdem_persona_fourbet_reshove_eligible_seen');
          if (on.action === 'all_in') {
            shoved++;
            expect(changed(on)).toBe(false);
          } else {
            refused++;
            expect(on.fires).toContain('holdem_persona_fourbet_reshove_changed_seen');
            instead.set(on.action, (instead.get(on.action) ?? 0) + 1);
          }
        }
    }
    const n = shoved + refused;
    expect(n).toBe(20 * 3 * 16);
    expect(refused).toBeGreaterThan(0);
    // The group's shove rate is its mean scale, give or take the sample.
    const meanScale = low.reduce((a, id) => a + holdemPersonaReRaiseScale(id), 0) / low.length;
    expect(Math.abs(shoved / n - meanScale)).toBeLessThan(0.08);
    // What a refused bluff class does instead: never a sized raise.
    expect([...instead.keys()].every((a) => a === 'fold' || a === 'call')).toBe(true);
    if (PRINT)
      console.log(
        'refused bluff-class reshoves did instead:',
        Object.fromEntries(instead),
        'shoved',
        shoved,
        'of',
        n
      );
  });

  it('value classes always shove, whatever the scale, and never read the persona', () => {
    for (const id of [...low, ...high])
      for (const depth of DEPTHS)
        for (const cards of VALUE) {
          const [on] = decideSpot('button_faces_3bet', id, cards, depth, 77, [ON_T]);
          expect(on.action).toBe('all_in');
          expect(personaFires(on)).toEqual([]);
        }
  });
});
