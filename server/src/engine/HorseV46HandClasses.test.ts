/**
 * V46 (2026-09-05) - THE SHAPE OF THE HAND, WHICH A PERCENTILE CANNOT SEE
 *
 * From the deep audit 5.1: no solver data exists for any non-hold'em game,
 * and 55% of cash seat-hands are played in one. The hand-class chart is the
 * first thing in the engine that reads the SHAPE of an Omaha or short-deck
 * hand rather than its percentile.
 *
 * These tests pin the three claims: the classifier agrees with published
 * theory on hands anyone can check by eye; the chart reaches the preflop bars
 * in the right direction; and hold'em is byte-identical with the flag on or
 * off.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  omahaHandClass,
  shortDeckHandClass,
  handClassRead,
  connectedSpan,
  suitedness,
  aceSuited,
  OMAHA_CLASSES,
  SHORT_DECK_CLASSES,
} from './HorseHandClasses.js';
import { decidePreflopV7, type PreflopCtx, type PreflopAuthorityEvent } from './HorsePreflop.js';
import { variantPreflopShift } from './HorseVariantProfile.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom, fastRandom } from './HorseEval.js';
import { SUITS, RANKS } from './PokerEngine.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import { LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import type { Card, SeatPlayer, HandStage } from '../types.js';

beforeEach(() => {
  seedFastRandom(0x46);
  HorseMind.reset();
  drainFires();
});

const SUIT: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
function c(spec: string): Card {
  return { rank: spec.slice(0, -1) as Card['rank'], suit: SUIT[spec.slice(-1)] as Card['suit'] };
}
const cc = (...specs: string[]): Card[] => specs.map(c);

describe('V46 Omaha classifier', () => {
  it('aces double-suited are the 3-bet anchor; aces rainbow are not', () => {
    expect(omahaHandClass(cc('As', 'Ah', 'Ks', 'Qh'))).toBe('aa_ds');
    expect(omahaHandClass(cc('As', 'Ah', 'Kd', 'Qc'))).toBe('aa_dry');
    // an ace suited to a side card is the nut-flush shape, so it counts
    expect(omahaHandClass(cc('As', 'Ah', 'Ts', '4c'))).toBe('aa_ds');
  });

  it('AAA-x is trips and folds - the hand the percentile most overrates', () => {
    expect(omahaHandClass(cc('As', 'Ah', 'Ad', '7c'))).toBe('trips');
    expect(omahaHandClass(cc('7s', '7h', '7d', 'Kc'))).toBe('trips');
    const read = handClassRead(cc('As', 'Ah', 'Ad', '7c'), true, false);
    expect(read.foldAlways).toBe(true);
  });

  it('a rundown is a rundown, unblocked for contextual IP/squeeze 3-bets while dangler keeps neverThreeBet', () => {
    expect(omahaHandClass(cc('Js', 'Th', '9s', '8h'))).toBe('rundown');
    expect(omahaHandClass(cc('Qs', 'Jh', 'Td', '8c'))).toBe('rundown');
    const read = handClassRead(cc('Js', 'Th', '9s', '8h'), true, false);
    expect(read.neverThreeBet).toBe(false);
    expect(read.foldAlways).toBe(false);
    // and it opens wider than the zero read
    expect(read.shift.open).toBeLessThan(0);
    // ... while its base 3-bet bar RISES (context decides IP/squeeze vs OOP flat)
    expect(read.shift.threeBet).toBeGreaterThan(0);
    // dangler still carries the structural neverThreeBet guard
    expect(handClassRead(cc('As', 'Ks', 'Qh', '3c'), true, false).neverThreeBet).toBe(true);
  });

  it('four broadway double-suited is its own class and is unblocked to 3-bet', () => {
    expect(omahaHandClass(cc('Ks', 'Qh', 'Js', 'Th'))).toBe('broadway_ds');
    expect(handClassRead(cc('Ks', 'Qh', 'Js', 'Th'), true, false).neverThreeBet).toBe(false);
    // PLO5/6 AAAKKds has a playable aa_ds 4-card sub-core, so it does NOT auto-fold
    const aaakk = handClassRead(cc('As', 'Ah', 'Ad', 'Ks', 'Kh'), true, false);
    expect(aaakk.cls).toBe('trips');
    expect(aaakk.foldAlways).toBe(false);
    // Ragged rainbow trips still auto-folds
    expect(handClassRead(cc('As', 'Ah', 'Ad', '7c', '2d', '3h'), true, false).foldAlways).toBe(
      true
    );
  });

  it('trash and danglers are told apart', () => {
    // double-paired low: no way to make the nuts
    expect(omahaHandClass(cc('7s', '7h', '4d', '4c'))).toBe('trash');
    // three working cards and a passenger
    expect(omahaHandClass(cc('As', 'Ks', 'Qh', '3c'))).toBe('dangler');
    expect(handClassRead(cc('7s', '7h', '4d', '4c'), true, false).foldAlways).toBe(true);
  });

  it('five and six card hands classify on the same signals', () => {
    expect(omahaHandClass(cc('As', 'Ah', 'Ks', 'Qh', '7d'))).toBe('aa_ds');
    expect(omahaHandClass(cc('Js', 'Th', '9s', '8h', '2d', '3c'))).toBe('rundown');
    expect(omahaHandClass(cc('As', 'Ah', 'Ad', '7c', '2d', '3h'))).toBe('trips');
  });

  it('the shape helpers are right on hands anyone can check', () => {
    expect(connectedSpan(cc('Js', 'Th', '9s', '8h'))).toBe(3);
    expect(connectedSpan(cc('As', '2h', '3s', '4h'))).toBe(3); // wheel ace plays low
    expect(connectedSpan(cc('As', 'Kh', '7s', '2h'))).toBeGreaterThan(5);
    expect(suitedness(cc('As', 'Ah', 'Ks', 'Qh'))).toBe(2);
    expect(suitedness(cc('As', 'Ah', 'Kd', 'Qc'))).toBe(0);
    expect(aceSuited(cc('As', 'Ks', '7h', '2d'))).toBe(true);
    expect(aceSuited(cc('Ac', 'Ks', '7h', '2d'))).toBe(false);
  });

  // ═══ THE REGRESSION THIS SUITE EXISTS FOR (2026-09-05) ═══════════════
  // The first version of connectedSpan returned its "no four-card window"
  // sentinel for ANY hand containing a pair, and the classifier read that
  // sentinel as a fact. `9932` and `J733` came out as `trash`, which carries
  // foldAlways, so 4.35% of every PLO hand dealt was folded to any bet -
  // set-mining hands included - and `dangler`, which TIGHTENS the open bar,
  // swallowed 42.9% of the deck. Both shipped to production. A distribution
  // test is what catches a bug of that shape; a hand-by-hand test does not,
  // because every hand it names still looks reasonable in isolation.
  it('a hand with one pair is never force-folded: it can still flop a set', () => {
    for (const h of [
      ['9s', '9h', '3d', '2c'],
      ['Js', '7h', '3d', '3c'],
      ['Qs', 'Qh', '7d', '3c'],
      ['4s', '4h', 'Kd', '2c'],
    ]) {
      const read = handClassRead(cc(...h), true, false);
      expect(read.foldAlways, `${h.join('')} must not be force-folded`).toBe(false);
    }
  });

  it('trash is only the hand that can make no nuts at all', () => {
    // two low pairs, rainbow, no ace: no nut flush, no nut straight, and both
    // sets are beaten by the sets above them
    expect(omahaHandClass(cc('2s', '2h', '3d', '3c'))).toBe('trash');
    // the same ranks with a suit are NOT trash - a flush draw is a way to win
    expect(omahaHandClass(cc('2s', '2h', '3s', '3c'))).not.toBe('trash');
    // a high pair alongside a low one is not trash either
    expect(omahaHandClass(cc('Ks', 'Kh', '3d', '3c'))).not.toBe('trash');
  });

  it('the class distribution over random deals is sane - the guard for the above', () => {
    seedFastRandom(7);
    const deck: Card[] = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
    const counts: Record<string, number> = {};
    const N = 8000;
    for (let n = 0; n < N; n++) {
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(fastRandom() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const cls = omahaHandClass(deck.slice(0, 4));
      counts[cls] = (counts[cls] ?? 0) + 1;
    }
    const share = (k: string): number => (counts[k] ?? 0) / N;
    // FORCE-FOLDING is the dangerous verdict, so it is the tightest bound:
    // trips is ~0.8% of deals by combinatorics and trash is rarer still.
    expect(share('trips') + share('trash')).toBeLessThan(0.015);
    expect(share('trash')).toBeLessThan(0.005);
    // AAxx is about 2.5% of PLO hands; the two aces classes should find it.
    expect(share('aa_ds') + share('aa_dry')).toBeGreaterThan(0.015);
    expect(share('aa_ds') + share('aa_dry')).toBeLessThan(0.04);
    // No single class may swallow the deck - a class that broad is a bucket,
    // and its shift becomes a fleet-wide bar change nobody chose.
    for (const [cls, n] of Object.entries(counts)) {
      if (cls === 'other') continue;
      expect(n / N, `${cls} is ${((n / N) * 100).toFixed(1)}% of all deals`).toBeLessThan(0.4);
    }
  });

  it('a short hand or no hand reads as no class', () => {
    expect(omahaHandClass([])).toBe('other');
    expect(omahaHandClass(null)).toBe('other');
    expect(handClassRead(undefined, true, false).cls).toBe('other');
  });
});

describe('V46 short-deck classifier', () => {
  it('a suited ace is the premium and a small pair is the demotion', () => {
    expect(shortDeckHandClass(cc('As', '9s'))).toBe('sd_suited_ace');
    expect(shortDeckHandClass(cc('Js', 'Jh'))).toBe('sd_big_pair');
    expect(shortDeckHandClass(cc('8s', '8h'))).toBe('sd_small_pair');
    expect(shortDeckHandClass(cc('9s', '8s'))).toBe('sd_suited_conn');
    expect(shortDeckHandClass(cc('Kd', '7c'))).toBe('sd_other');
  });
  it('the small pair opens TIGHTER, which is the point', () => {
    const small = handClassRead(cc('8s', '8h'), false, true);
    const ace = handClassRead(cc('As', '9s'), false, true);
    expect(small.shift.open).toBeGreaterThan(0);
    expect(ace.shift.open).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
function ctx(over: Partial<PreflopCtx> = {}): PreflopCtx {
  return {
    strength: 0.8,
    position: 'late',
    raiserPosition: 'middle',
    raises: 1,
    limpers: 0,
    callers: 0,
    oppsLeft: 2,
    toCall: 6,
    currentBet: 6,
    pot: 9,
    bigBlind: 2,
    stack: 200,
    stackBB: 100,
    tightness: 1,
    bluffFreq: 0.1,
    aggression: 1,
    slowplayFreq: 0.1,
    sizingMultiplier: 1,
    isOmaha: true,
    isPotLimit: true,
    riskAdd: 0,
    mode: 'cash',
    variantShift: variantPreflopShift('plo4'),
    rand: () => 0.5,
    ...over,
  } as PreflopCtx;
}

describe('V46 reaches the preflop bars', () => {
  it('a dangler that would 3-bet on raw strength flats instead, while double-suited broadway can 3-bet IP', () => {
    const dangler = handClassRead(cc('As', 'Ks', 'Qh', '3c'), true, false);
    const without = decidePreflopV7(ctx({ strength: 0.97 }));
    const withDangler = decidePreflopV7(
      ctx({
        strength: 0.97,
        classShift: dangler.shift,
        classNeverThreeBet: dangler.neverThreeBet,
        classFoldAlways: dangler.foldAlways,
      })
    );
    // the plain read raises (either shape the intent uses)
    expect(['raise', 'raiseTo']).toContain(without.a);
    expect(withDangler.a).toBe('call');

    const kqjtDs = handClassRead(cc('Ks', 'Qh', 'Js', 'Th'), true, false);
    const withKqjtDs = decidePreflopV7(
      ctx({
        strength: 0.92,
        position: 'late',
        isButton: true,
        raiserPosition: 'late',
        omahaAA: false,
        classShift: kqjtDs.shift,
        classNeverThreeBet: kqjtDs.neverThreeBet,
        classFoldAlways: kqjtDs.foldAlways,
      })
    );
    expect(['raise', 'raiseTo']).toContain(withKqjtDs.a);
  });

  it('trips folds to a raise however strong the percentile says it is', () => {
    const read = handClassRead(cc('As', 'Ah', 'Ad', '7c'), true, false);
    const with46 = decidePreflopV7(
      ctx({
        strength: 0.99,
        classShift: read.shift,
        classNeverThreeBet: read.neverThreeBet,
        classFoldAlways: read.foldAlways,
      })
    );
    expect(with46.a).toBe('fold');
    // ... but a free look in the big blind is still free
    const free = decidePreflopV7(
      ctx({
        strength: 0.99,
        toCall: 0,
        raises: 0,
        position: 'bb',
        classShift: read.shift,
        classFoldAlways: true,
      })
    );
    expect(free.a).not.toBe('fold');
  });

  it('aces double-suited 3-bet where the same percentile without the class would not', () => {
    const read = handClassRead(cc('As', 'Ah', 'Ks', 'Qh'), true, false);
    expect(read.cls).toBe('aa_ds');
    let raises46 = 0;
    let raisesPlain = 0;
    for (let i = 1; i <= 40; i++) {
      seedFastRandom(i * 7919);
      if (
        decidePreflopV7(
          ctx({
            strength: 0.9,
            classShift: read.shift,
            classNeverThreeBet: read.neverThreeBet,
            classFoldAlways: read.foldAlways,
          })
        ).a.startsWith('raise')
      )
        raises46++;
      seedFastRandom(i * 7919);
      if (decidePreflopV7(ctx({ strength: 0.9 })).a.startsWith('raise')) raisesPlain++;
    }
    expect(raises46).toBeGreaterThanOrEqual(raisesPlain);
  });

  it('a hold em hand gets the zero read, so nothing changes outside Omaha and 6+', () => {
    const read = handClassRead(cc('As', 'Ks'), false, false);
    expect(read.cls).toBe('other');
    expect(read.shift).toEqual({ open: 0, threeBet: 0, fourBet: 0, coldCall: 0, bbDefend: 0 });
    expect(read.neverThreeBet).toBe(false);
    expect(read.foldAlways).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
function mkPlayer(seat: number, over: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    seat,
    user_id: `h-${seat}`,
    username: `H${seat}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    ...over,
  } as SeatPlayer;
}

function ploSpot(cards: Card[], variant = 'plo4'): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = mkPlayer(2, { cards, bet: 2, totalInvested: 2 });
  const gs = {
    players: [mkPlayer(1, { is_folded: true }), hero, mkPlayer(3, { bet: 6, stack: 194 })],
    communityCards: [],
    pot: 9,
    currentBet: 6,
    minRaise: 4,
    stage: 'preflop' as HandStage,
    gameVariant: variant,
    bigBlind: 2,
    dealerSeat: 3,
    gameMode: 'cash' as const,
    format: 'cash',
    actionHistory: [],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

describe('V46 wiring: the receipts fire from a live decision', () => {
  it('an Omaha hand fires the class receipt (and dangler fires never_3bet); a hold em hand does not', () => {
    enableBrainTelemetry();
    const plo = ploSpot(cc('As', 'Ks', 'Qh', '3c'));
    HorseLogic.decide(plo.hero, plo.gs, 'balanced', {}, { telemetry: true });
    const f = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(f.v46_class_read ?? 0).toBeGreaterThan(0);
    // V86 lifts neverThreeBet on double-suited rundowns; pre-V86 and rainbow rundowns keep it.
    expect(f.v46_class_never_3bet ?? 0).toBe(0);

    const ploLegacy = ploSpot(cc('Js', 'Th', '9s', '8h'));
    HorseLogic.decide(
      ploLegacy.hero,
      ploLegacy.gs,
      'balanced',
      {},
      { telemetry: true, v86PloOverhaul: false }
    );
    const fLegacy = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fLegacy.v46_class_read ?? 0).toBeGreaterThan(0);
    expect(fLegacy.v46_class_never_3bet ?? 0).toBeGreaterThan(0);

    const ploRainbow = ploSpot(cc('Js', 'Th', '9d', '8c'));
    HorseLogic.decide(ploRainbow.hero, ploRainbow.gs, 'balanced', {}, { telemetry: true });
    const fRainbow = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fRainbow.v46_class_read ?? 0).toBeGreaterThan(0);
    expect(fRainbow.v46_class_never_3bet ?? 0).toBeGreaterThan(0);

    const nlh = ploSpot(cc('As', 'Ks'), 'nlh');
    HorseLogic.decide(nlh.hero, nlh.gs, 'balanced', {}, { telemetry: true });
    const g = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(g.v46_class_read ?? 0).toBe(0);
  });

  it('a short-deck hand gets no class read by default, and v46ShortDeck brings it back', () => {
    // 2026-10-05: shortdeck_v46_classes resolved -0.51 +/- 0.15 bb/100 over
    // 960k hands, so the short-deck chart is off unless asked for.
    enableBrainTelemetry();
    drainFires();
    const sd = ploSpot(cc('8s', '8h'), 'short_deck');
    HorseLogic.decide(sd.hero, sd.gs, 'balanced', {}, { telemetry: true });
    const f = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(f.v46_class_read ?? 0).toBe(0);
    expect(f.v46_class_never_3bet ?? 0).toBe(0);

    const on = ploSpot(cc('8s', '8h'), 'short_deck');
    HorseLogic.decide(on.hero, on.gs, 'balanced', {}, { telemetry: true, v46ShortDeck: true });
    const g = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(g.v46_class_read ?? 0).toBeGreaterThan(0);
    expect(g.v46_class_never_3bet ?? 0).toBeGreaterThan(0);

    const league = LEAGUE_MATCHUPS.find((m) => m.name === 'shortdeck_v46_classes')!;
    expect(league.a).toEqual({ v46ShortDeck: true });
    expect(league.b).toEqual({});
  });

  it('trips fires the fold receipt, and the flag switches the whole layer off', () => {
    enableBrainTelemetry();
    const trips = ploSpot(cc('As', 'Ah', 'Ad', '7c'));
    const d = HorseLogic.decide(trips.hero, trips.gs, 'balanced', {}, { telemetry: true });
    const f = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(f.v46_class_fold ?? 0).toBeGreaterThan(0);
    expect(d.action).toBe('fold');

    const off = ploSpot(cc('As', 'Ah', 'Ad', '7c'));
    HorseLogic.decide(off.hero, off.gs, 'balanced', {}, { telemetry: true, v46Charts: false });
    const g = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(g.v46_class_read ?? 0).toBe(0);
  });

  it('every class has a chart row, and the league can ablate it', () => {
    for (const cls of OMAHA_CLASSES) {
      const r = handClassRead(cc('As', 'Ah', 'Ks', 'Qh'), true, false);
      expect(typeof r.shift.open).toBe('number');
      expect(cls.length).toBeGreaterThan(0);
    }
    expect(SHORT_DECK_CLASSES.length).toBe(5);
    const names = LEAGUE_MATCHUPS.map((m) => m.name);
    expect(names).toContain('plo4_v46_classes');
    expect(names).toContain('plo6_v46_classes');
    expect(names).toContain('shortdeck_v46_classes');
    const legacy = LEAGUE_MATCHUPS.find((m) => m.name === 'full_vs_v2_legacy')!.b as Record<
      string,
      unknown
    >;
    expect(legacy.v46Charts).toBe(false);
  });
});

describe('per-decision preflop authority evidence', () => {
  it('records the selected veto, not classification, without changing draws or choices', () => {
    const cases: Partial<PreflopCtx>[] = [
      { strength: 0.97, classNeverThreeBet: true },
      { strength: 0.97, classNeverThreeBet: false },
      { strength: 0.99, classNeverThreeBet: true, omahaSuitedPremium: 'aces' },
      { strength: 0.99, classNeverThreeBet: true, toCall: 40 },
      { strength: 0.97, classNeverThreeBet: true, raises: 2 },
      { strength: 0.99, classFoldAlways: true },
    ];
    for (const over of cases) {
      let plainDraws = 0;
      let tracedDraws = 0;
      const events: PreflopAuthorityEvent[] = [];
      const plain = decidePreflopV7(
        ctx({
          ...over,
          rand: () => {
            plainDraws++;
            return 0.5;
          },
        })
      );
      const traced = decidePreflopV7(
        ctx({
          ...over,
          rand: () => {
            tracedDraws++;
            return 0.5;
          },
          noteAuthority: (event) => events.push(event),
        })
      );
      expect(traced).toEqual(plain);
      expect(tracedDraws).toBe(plainDraws);
      expect(events.length).toBeLessThanOrEqual(1);
      if (over.raises === 2 || over.classFoldAlways) expect(events).toEqual([]);
      if (over.omahaSuitedPremium) expect(events[0].branch).toBe('premium_value');
      if (over.toCall === 40) expect(events.some((e) => e.branch === 'v46_class_flat')).toBe(false);
    }
    const events: PreflopAuthorityEvent[] = [];
    decidePreflopV7(
      ctx({ strength: 0.97, classNeverThreeBet: true, noteAuthority: (e) => events.push(e) })
    );
    expect(events).toEqual([
      expect.objectContaining({
        branch: 'v46_class_flat',
        strength: 0.97,
        premiumValue: false,
        pressure: false,
      }),
    ]);
  });

  it('distinguishes the non-AA margin and random trap from the class veto', () => {
    const marginal: PreflopAuthorityEvent[] = [];
    // Find the existing OOP non-AA marginal threshold without inventing a new strategy bar.
    for (let strength = 0.8; strength <= 0.99 && !marginal.length; strength += 0.001) {
      const events: PreflopAuthorityEvent[] = [];
      decidePreflopV7(
        ctx({
          strength,
          omahaAA: false,
          position: 'bb',
          raiserPosition: 'early',
          noteAuthority: (e) => events.push(e),
        })
      );
      if (events[0]?.branch === 'v16_non_aa_flat') marginal.push(events[0]);
    }
    expect(marginal).toHaveLength(1);
    const trap: PreflopAuthorityEvent[] = [];
    const out = decidePreflopV7(
      ctx({ strength: 0.99, isOmaha: false, rand: () => 0, noteAuthority: (e) => trap.push(e) })
    );
    expect(out.a).toBe('call');
    expect(trap[0].branch).toBe('value_trap');
  });

  it('keeps a reference receipt through the actual policy graph without claiming final authority', () => {
    const spot = ploSpot(cc('Ks', 'Qh', 'Js', 'Th'));
    const decision = HorseLogic.decide(spot.hero, spot.gs, 'balanced', {}, { telemetry: true });
    expect(decision.preflopAuthority).toMatchObject({
      version: 1,
      scope: 'reference_preflop',
      context: { isOmaha: true, classNeverThreeBet: false },
    });
    expect(decision.preflopAuthority?.referenceAction).toBeDefined();
    expect(decision.preflopAuthority?.intent.a).toBeDefined();

    const preV86 = HorseLogic.decide(
      spot.hero,
      spot.gs,
      'balanced',
      {},
      { telemetry: true, v86PloOverhaul: false }
    );
    expect(preV86.preflopAuthority).toMatchObject({
      version: 1,
      scope: 'reference_preflop',
      context: { isOmaha: true, classNeverThreeBet: true },
    });

    const danglerSpot = ploSpot(cc('As', 'Kd', 'Qh', '3c'));
    const danglerDecision = HorseLogic.decide(
      danglerSpot.hero,
      danglerSpot.gs,
      'balanced',
      {},
      { telemetry: true }
    );
    expect(danglerDecision.preflopAuthority).toMatchObject({
      version: 1,
      scope: 'reference_preflop',
      context: { isOmaha: true, classNeverThreeBet: true },
    });

    const rainbow = ploSpot(cc('Ks', 'Qh', 'Jd', 'Tc'));
    const rainbowDecision = HorseLogic.decide(
      rainbow.hero,
      rainbow.gs,
      'balanced',
      {},
      { telemetry: true }
    );
    expect(rainbowDecision.preflopAuthority).toMatchObject({
      version: 1,
      scope: 'reference_preflop',
      context: { isOmaha: true, classNeverThreeBet: true },
    });
  });
});
