/**
 * PERSONA RE-RAISE MIX (D3 option C, option holdemPersonaReRaiseMix, default
 * OFF): persona-specific 3-bet bluffs, squeeze bluffs and 26-35bb four-bet
 * reshove bluffs in two-card no-limit hold'em.
 *
 *  (a) OFF is main: with the option absent and with it false, every decision
 *      of ten seeded runs equals a control RECORDED FROM THE PARENT COMMIT
 *      (action, amount, random-stream state), and equals a second control
 *      that injects the persona at scale 1 with the consumed draw as its
 *      unit, which shows the on path draws where the off path draws.
 *  (b) ON never reaches Omaha, short deck, fixed limit, pot-limit hold'em or
 *      an All-In-Or-Fold table.
 *  (c) ON in hold'em consumes the same draws at the bluff sites and orders
 *      the archetypes LAG > TAG > Tricky > Nit.
 *  (d) The unit is deterministic per hand: one value per behaviour for the
 *      Horse's whole hand whatever the stack and pot, another for the next
 *      hand, the same for the fast and the deep look and across a retry.
 *  (e) The four-bet reshove's bluff classes shove at the Horse's scale; value
 *      classes always shove.
 *  (f) Against an opener the style read respects as tight the persona never
 *      raises a bluff probability; a shadow arm changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, SeatPlayer, ActionRecord } from '../types.js';

// The second control of (a). Pass-through unless a test switches it on; then
// every preflop decision is made with the persona field present at scale 1
// and the unit read back as the draw the site has just consumed, so the
// scaled comparison `u < min(1, p * 1)` is the unscaled `roll < p`, and the
// reshove unit 0 always shoves.
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
import { setHoldemPersonaReRaiseTap, type HoldemPersonaReRaiseTapEvent } from './HorsePreflop.js';
import { horsePlanContextFromDecision, horsePlanContextKey } from './HorsePlanHandIdentity.js';
import { LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import {
  decideArms,
  probeRng,
  syntheticFleet,
  syntheticHorseId,
  type ProbeArm,
  type ProbeRead,
  type ProbeTable,
  type ProbeTableState,
} from '../benchmark/HoldemPreflopProbe.js';
import {
  OFF_RUNS,
  offLine,
  playOffRun,
  recordOffControl,
  type OffControl,
} from './HorseHoldemPersonaReRaiseMix.off-control.test-support.js';
import {
  VILLAINS,
  decide as decideStyleSpot,
  install as installVillain,
  preflopOpen,
} from './HorseOpponentStyle.contexts.test-support.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROL_PATH = join(HERE, 'fixtures', 'horse-holdem-persona-reraise-off-control.json');
const PRINT = process.env.PERSONA_RERAISE_PRINT === '1';
const FLEET = syntheticFleet();
const TABLE_ID = syntheticHorseId(700000001);
const handOpts = (handNumber: number, tableId = TABLE_ID) => ({
  mindPlanContext: { version: 1, hand: { version: 1, tableId, handNumber } },
});

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
const onAt = (handNumber: number): ProbeArm => ({
  opts: { holdemPersonaReRaiseMix: true, ...handOpts(handNumber) },
  telemetry: true,
});

const FALLBACK = 'holdem_persona_hand_identity_fallback_seen';
const same = (a: ProbeRead, b: ProbeRead) =>
  a.action === b.action && a.amount === b.amount && a.rngAfter === b.rngAfter;
/** Persona receipts of a decision, apart from the hand-identity fallback count. */
const personaFires = (r: ProbeRead) =>
  r.fires.filter((f) => f.startsWith('holdem_persona_') && f !== FALLBACK);
const changed = (r: ProbeRead) => r.fires.some((f) => /^holdem_persona_.*_changed_seen$/.test(f));
const eligible = (r: ProbeRead) => r.fires.some((f) => /^holdem_persona_.*_eligible_seen$/.test(f));

/** The engine's offline tap, for the tests that read a unit or a scale. */
const tapped: HoldemPersonaReRaiseTapEvent[] = [];
const tap = () => {
  tapped.length = 0;
  setHoldemPersonaReRaiseTap((e) => tapped.push(e));
};
afterEach(() => setHoldemPersonaReRaiseTap(null));

describe('persona re-raise mix: OFF is main', () => {
  if (process.env.HOLDEM_PERSONA_OFF_CONTROL_RECORD) {
    it('records the control (run this from the parent commit, see the test-support header)', () => {
      const out: OffControl = {
        recordedFrom: process.env.HOLDEM_PERSONA_OFF_CONTROL_FROM ?? 'unstated',
        runs: recordOffControl(),
      };
      writeFileSync(process.env.HOLDEM_PERSONA_OFF_CONTROL_RECORD!, JSON.stringify(out));
      expect(Object.keys(out.runs).length).toBe(OFF_RUNS.length);
    });
    return;
  }
  const recorded = JSON.parse(readFileSync(CONTROL_PATH, 'utf8')) as OffControl;
  let total = 0;
  let reshoveSpots = 0;
  OFF_RUNS.forEach((run, index) =>
    it(`${run.name}: absent and false equal the recording from main, and the scale-1 control`, () => {
      const lines = recorded.runs[run.name];
      expect(lines.length).toBeGreaterThan(run.hands * 4);
      control.unitReads = 0;
      let decisions = 0;
      // The option-on look (last arm) only says whether the recorded run
      // passes through the reshove site; it does not drive the hand.
      playOffRun(run, index, [ABSENT, FALSE, CONTROL, ...(run.persona ? [ON_T] : [])], (spot) => {
        const [absent, off, ctl, look] = spot.reads;
        const main = lines[decisions];
        decisions++;
        if (offLine(absent) !== main || offLine(off) !== main)
          throw new Error(
            `${run.name} decision ${decisions}: main ${main} absent ${offLine(absent)} false ${offLine(off)}`
          );
        if (!same(absent, ctl))
          throw new Error(
            `${run.name} decision ${decisions}: absent ${offLine(absent)} control ${offLine(ctl)}`
          );
        if (look?.fires.includes('holdem_persona_fourbet_reshove_eligible_seen')) reshoveSpots++;
      });
      expect(decisions).toBe(lines.length);
      total += decisions;
      if (PRINT)
        console.log(`(a) ${run.name}: ${decisions} decisions, unit reads ${control.unitReads}`);
      // The scale-1 control is not vacuous where a bluff site exists (an
      // All-In-Or-Fold table returns before every one of them).
      if (!run.allInOrFold) expect(control.unitReads).toBeGreaterThan(0);
    })
  );
  it('covers a few thousand decisions recorded from the parent commit, through the reshove site', () => {
    expect(recorded.recordedFrom).toBe('8a8656b17b5');
    expect(total).toBeGreaterThan(5000);
    expect(reshoveSpots).toBeGreaterThan(0);
  });
});

describe('persona re-raise mix: ON never reaches another variant or structure', () => {
  OFF_RUNS.forEach((run, index) => {
    if (run.persona) return;
    it(`${run.name}: decisions and draws equal the option off, and no persona site is reached`, () => {
      let decisions = 0;
      let fieldBuilt = 0;
      playOffRun(run, 100 + index, [OFF_T, ON_T], (spot) => {
        decisions++;
        const [off, on] = spot.reads;
        expect(same(off, on), `${run.name} decision ${decisions}`).toBe(true);
        expect(personaFires(on)).toEqual([]);
        if (on.fires.includes(FALLBACK)) fieldBuilt++;
      });
      expect(decisions).toBeGreaterThan(run.hands * 4);
      // All-In-Or-Fold hold'em is no-limit hold'em, so the context field IS
      // built there (seen here as the fallback count, no hand being supplied);
      // its branch returns before any site that reads it. Every other run in
      // this group never gets the field at all.
      if (run.allInOrFold) expect(fieldBuilt).toBe(decisions);
      else expect(fieldBuilt).toBe(0);
    });
  });
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
function eligibleBluffSpots(want: number): { cards: Card[]; seed: number; hand: number }[] {
  const r = probeRng(0xbeef);
  const out: { cards: Card[]; seed: number; hand: number }[] = [];
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
    const hand = 1000000 + k;
    const [on] = decideSpot('bb_faces_button_open', probeId, cards, 100, seed, [onAt(hand)]);
    if (on.fires.includes('holdem_persona_3bet_bluff_eligible_seen'))
      out.push({ cards, seed, hand });
  }
  return out;
}

describe("persona re-raise mix: ON in no-limit hold'em", () => {
  it('consumes the same draws at the bluff sites: a decision the persona did not change equals the option off, draw for draw', () => {
    let unchangedEligible = 0;
    let changedCount = 0;
    let actionMoved = 0;
    const reached = new Map<string, number>();
    OFF_RUNS.forEach((run, index) => {
      if (!run.persona) return;
      playOffRun({ ...run, hands: run.hands * 4 }, 200 + index, [OFF_T, ON_T], (spot) => {
        const [off, on] = spot.reads;
        expect(off.fires.filter((f) => f.startsWith('holdem_persona_'))).toEqual([]);
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
      });
    });
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
          const [on] = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [
            onAt(spot.hand),
          ]);
          if (on.fires.includes('holdem_persona_3bet_bluff_eligible_seen')) e++;
          if (on.bluffBranch) t++;
          // A hand was supplied: the fallback is never used.
          expect(on.fires).not.toContain(FALLBACK);
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

  describe('the unit is deterministic per hand', () => {
    const id = idsOf('nit_hunter', 1)[0];
    const unitOf = (
      kind: Parameters<typeof sixHandedSpot>[0],
      cards: Card[],
      depth: number,
      seed: number,
      opts: Record<string, unknown>
    ): number | undefined => {
      tap();
      decideSpot(kind, id, cards, depth, seed, [
        { opts: { holdemPersonaReRaiseMix: true, ...opts } },
      ]);
      return tapped[0]?.unit;
    };

    it('one hand, one unit: the same decision twice, and any stack and pot in that hand', () => {
      let compared = 0;
      for (const spot of spots.slice(0, 25)) {
        const a = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [
          onAt(1000077),
        ]);
        const b = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [
          onAt(1000077),
        ]);
        expect(b).toEqual(a);
        const u = unitOf('bb_faces_button_open', spot.cards, 100, spot.seed, handOpts(1000077));
        expect(u).toBeGreaterThanOrEqual(0);
        // Stack depth changes the Horse's stack and nothing else about the
        // hand; the seed changes the draws. The unit does not move.
        for (const [depth, seed] of [
          [80, spot.seed],
          [100.25, spot.seed],
          [137, spot.seed + 9],
        ]) {
          const v = unitOf('bb_faces_button_open', spot.cards, depth, seed, handOpts(1000077));
          if (v === undefined) continue;
          expect(v).toBe(u);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(40);
    });

    it('the next hand, and another table, give another unit; each behaviour has its own', () => {
      const spot = spots[0];
      const units = new Set<number>();
      for (let k = 0; k < 40; k++)
        units.add(
          unitOf('bb_faces_button_open', spot.cards, 100, spot.seed, handOpts(1000100 + k))!
        );
      expect(units.size).toBe(40);
      const here = unitOf('bb_faces_button_open', spot.cards, 100, spot.seed, handOpts(1000100));
      const there = unitOf(
        'bb_faces_button_open',
        spot.cards,
        100,
        spot.seed,
        handOpts(1000100, syntheticHorseId(700000002))
      );
      expect(there).not.toBe(here);
      // The same Horse, hand and cards at the reshove site: a different salt.
      const a5s = [c('A', 0), c('5', 0)];
      const reshove = unitOf('button_faces_3bet', a5s, 30, 77, handOpts(1000100));
      const threeBet = unitOf('bb_faces_button_open', a5s, 100, 77, handOpts(1000100));
      expect(reshove).toBeGreaterThanOrEqual(0);
      if (threeBet !== undefined) expect(threeBet).not.toBe(reshove);
    });

    it('the fast look, the deep second look and a retry of the turn derive the same hand, so the same unit', () => {
      // What the worker does (workerRuntime executeFast / executeDeep): both
      // pass mindPlanContext = horsePlanContextFromDecision(request). The deep
      // request is the same snapshot retyped (client.decideDeep); a retry, or
      // a later turn of the hand, has another lease or generation in its
      // fence and the same table and hand.
      const table = '0f0f0f0f-0000-4000-8000-00000000abcd';
      const lease = '11111111-2222-4333-8444-555555555555';
      const request = (generation: number, leaseId = lease) => ({
        fence: `${table}:1234567:2:${leaseId}:${generation}`,
        generation,
        player: { seat: 2 },
      });
      const fast = horsePlanContextFromDecision(request(7));
      const deep = horsePlanContextFromDecision({ ...request(7) });
      const retry = horsePlanContextFromDecision(
        request(9, '99999999-2222-4333-8444-555555555555')
      );
      expect(horsePlanContextKey(fast)).toBe(`plan-hand-v1:${table}:1234567`);
      expect(horsePlanContextKey(deep)).toBe(horsePlanContextKey(fast));
      expect(horsePlanContextKey(retry)).toBe(horsePlanContextKey(fast));
      const spot = spots[0];
      const asFast = unitOf('bb_faces_button_open', spot.cards, 100, spot.seed, {
        mindPlanContext: fast,
        mindObservationHand: fast.hand,
        observeMind: true,
      });
      // The deep look is not given mindObservationHand, and samples deeper.
      const asDeep = unitOf('bb_faces_button_open', spot.cards, 100, spot.seed, {
        mindPlanContext: deep,
        observeMind: false,
        deepEquity: 2,
      });
      const asRetry = unitOf('bb_faces_button_open', spot.cards, 100, spot.seed + 5, {
        mindPlanContext: retry,
      });
      expect(asFast).toBeGreaterThanOrEqual(0);
      expect(asDeep).toBe(asFast);
      expect(asRetry).toBe(asFast);
    });

    it('with no hand supplied the named fallback is used, counted, and moves with the stack', () => {
      const spot = spots[0];
      const [on] = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [ON_T]);
      expect(on.fires).toContain(FALLBACK);
      const [withHand] = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [
        onAt(1000100),
      ]);
      expect(withHand.fires).not.toContain(FALLBACK);
      const units = new Set<number>();
      for (let k = 0; k < 20; k++)
        units.add(unitOf('bb_faces_button_open', spot.cards, 100 + k * 0.25, spot.seed, {})!);
      expect(units.size).toBeGreaterThan(15);
      // A legacy hand number (below the allocated range) is not a hand identity.
      const [legacy] = decideSpot('bb_faces_button_open', id, spot.cards, 100, spot.seed, [
        onAt(12),
      ]);
      expect(legacy.fires).toContain(FALLBACK);
    });

    it('the league card supplies a hand to both arms', () => {
      const card = LEAGUE_MATCHUPS.find((m) => m.name === 'cash6_holdem_persona_reraise_mix')!;
      expect(card.handIdentity).toBe('deal_seed');
      expect(card.a).toEqual({ holdemPersonaReRaiseMix: true });
      expect(card.b).toEqual({});
    });
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
  // Every (Horse, depth, combo) is its own hand.
  let hand = 2000000;

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
          const [on] = decideSpot('button_faces_3bet', id, cards, depth, 77, [onAt(hand++)]);
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
          const [on] = decideSpot('button_faces_3bet', id, cards, depth, 77, [onAt(hand++)]);
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
          const [on] = decideSpot('button_faces_3bet', id, cards, depth, 77, [onAt(hand++)]);
          expect(on.action).toBe('all_in');
          expect(personaFires(on)).toEqual([]);
        }
  });
});

// The style read's own path: HorseMind holds a villain, the option
// styleTightReRaiserRespect asks HorseOpponentStyle.tightOpenerRespect about
// him, and for a credibly tight opener HorseLogic builds ctx.exploitOpener
// { wide: false, maxBarMove, callBump } (HorseLogic, STYLE READ #6). That
// object is the signal the persona reads. In SHADOW the same code computes
// the classification, records that it engaged and builds nothing, so no
// signal reaches the preflop module.
describe('persona re-raise mix: a style read is not undone by the persona', () => {
  const R = '23456789TJQKA';
  const S = 'cdhs';
  const HOLDINGS: string[] = [];
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b += 3)
      HOLDINGS.push(`${R[a % 13]}${S[Math.floor(a / 13)]}${R[b % 13]}${S[Math.floor(b / 13)]}`);
  const lag = FLEET.find((id) => holdemPersonaReRaiseScale(id) > 1.3)!;
  const nit = FLEET.find((id) => holdemPersonaReRaiseScale(id) < 0.7)!;

  /** Every big-blind holding against the villain's open: the persona events. */
  function sweep(
    heroId: string,
    villain: keyof typeof VILLAINS,
    opts: Record<string, unknown>
  ): { events: HoldemPersonaReRaiseTapEvent[]; outcomes: string[]; held: number } {
    const events: HoldemPersonaReRaiseTapEvent[] = [];
    const outcomes: string[] = [];
    let held = 0;
    tap();
    HOLDINGS.forEach((holding, k) => {
      const spot = preflopOpen('cash', holding, 200);
      spot.hero.user_id = heroId;
      installVillain(VILLAINS[villain], 'cash');
      tapped.length = 0;
      const d = decideStyleSpot(spot, {
        holdemPersonaReRaiseMix: true,
        ...handOpts(3000000 + k),
        ...opts,
      });
      outcomes.push(d.digest);
      if (tapped[0]) events.push({ ...tapped[0] });
      held += d.fires.holdem_persona_scale_held_by_style_seen ?? 0;
    });
    return { events, outcomes, held };
  }

  it('a scale > 1 Horse facing an opener the style read respects as tight never has its bluff probability raised', () => {
    const tight = sweep(lag, 'grinder', { styleTightReRaiserRespect: true });
    expect(tight.events.length).toBeGreaterThan(40);
    expect(tight.held).toBe(tight.events.length);
    for (const e of tight.events) {
      expect(e.scale).toBeGreaterThan(1.3);
      expect(e.scaleUsed).toBe(1);
      // The probability the persona used is the option-off probability.
      expect(Math.min(1, e.p * e.scaleUsed)).toBe(Math.min(1, e.p));
    }
    // Over the paired spots the Horse does not bluff more than the unscaled
    // comparison would: its rate is p's, where its own scale would give 1.3p.
    const expected = tight.events.reduce((a, e) => a + Math.min(1, e.p), 0);
    const fired = tight.events.filter((e) => e.fires).length;
    const unheld = tight.events.reduce((a, e) => a + Math.min(1, e.p * e.scale), 0);
    expect(unheld).toBeGreaterThan(expected * 1.25);
    expect(fired).toBeLessThan(expected + 2 * Math.sqrt(expected));
    if (PRINT)
      console.log(
        '(f) held: fired',
        fired,
        'expected at scale 1',
        expected,
        'at own scale',
        unheld
      );
  });

  it('a scale < 1 Horse still bluffs less against the tight opener', () => {
    const tight = sweep(nit, 'grinder', { styleTightReRaiserRespect: true });
    expect(tight.events.length).toBeGreaterThan(40);
    expect(tight.held).toBe(0);
    for (const e of tight.events) {
      expect(e.scaleUsed).toBe(e.scale);
      expect(e.scale).toBeLessThan(0.7);
    }
  });

  it('with no tight classification the scaled behaviour is unchanged', () => {
    // The style option on, against villains it does not classify as tight.
    for (const villain of ['none', 'station', 'tag'] as const) {
      const withStyle = sweep(lag, villain, { styleTightReRaiserRespect: true });
      const without = sweep(lag, villain, {});
      expect(withStyle.held).toBe(0);
      expect(withStyle.events.length).toBeGreaterThan(40);
      expect(withStyle.events).toEqual(without.events);
      expect(withStyle.outcomes).toEqual(without.outcomes);
      for (const e of withStyle.events) expect(e.scaleUsed).toBe(e.scale);
    }
  });

  it('a style option in SHADOW does not alter the persona behaviour at all', () => {
    const shadow = sweep(lag, 'grinder', { styleShadow: ['styleTightReRaiserRespect'] });
    const none = sweep(lag, 'grinder', {});
    expect(shadow.held).toBe(0);
    expect(shadow.events.length).toBeGreaterThan(40);
    expect(shadow.events).toEqual(none.events);
    expect(shadow.outcomes).toEqual(none.outcomes);
    for (const e of shadow.events) expect(e.scaleUsed).toBe(e.scale);
  });
});
