/**
 * OMAHA RE-RAISED POT DISCIPLINE (owner ruling 2026-11-14 23:49 Chicago,
 * option omahaReraisedPotDiscipline, default OFF after its evaluation failed, 2026-11-15): the cells, and the option
 * in the league (anonymised seats only).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  RERAISED_MIN_PREFLOP_RAISES,
  omahaReraisedEquity,
  omahaReraisedPostflopCell,
  omahaReraisedPreflopCell,
  omahaReraisedPremium,
  omahaReraisedStrongHand,
  omahaReraisedRealisticHand,
  omahaReraisedWeakMade,
  preflopRaiseCount,
  type OmahaReraisedInput,
} from './HorseOmahaReraisedPot.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

const pre = (o: Partial<OmahaReraisedInput> = {}): OmahaReraisedInput => ({
  variant: 'plo4',
  street: 'preflop',
  hole: cards('AsKdQs7d'),
  board: [],
  preflopRaises: 3,
  action: 'call',
  toCall: 60,
  stack: 170,
  pot: 101.5,
  hiLo: false,
  multiBoard: false,
  bombPot: false,
  tournament: false,
  allInOrFold: false,
  ...o,
});

const post = (o: Partial<OmahaReraisedInput> = {}): OmahaReraisedInput =>
  pre({
    street: 'turn',
    hole: cards('AsKd9h7c'),
    board: cards('Kh8s4d2c'),
    toCall: 60,
    stack: 60,
    pot: 300,
    ...o,
  });

describe('the measures', () => {
  it('preflop raises: bets, raises and an all-in that moved the bet; never a call-off or a blind', () => {
    const h = (action: string, isFullRaise?: boolean) => ({
      stage: 'preflop',
      action,
      isFullRaise,
    });
    expect(preflopRaiseCount([h('sb'), h('bb'), h('raise'), h('call'), h('raise')])).toBe(2);
    expect(preflopRaiseCount([h('raise'), h('raise'), h('all_in', false)])).toBe(3);
    expect(preflopRaiseCount([h('raise'), h('raise'), h('all_in')])).toBe(2);
    expect(preflopRaiseCount([{ stage: 'flop', action: 'bet' }])).toBe(0);
    expect(RERAISED_MIN_PREFLOP_RAISES).toBe(3);
  });

  it('premium: aces, kings double-suited, a high double-suited rundown; not ace-high broadway', () => {
    expect(omahaReraisedPremium(cards('AhAd7c2s'))).toBe(true);
    expect(omahaReraisedPremium(cards('KhKdQhJd'))).toBe(true);
    expect(omahaReraisedPremium(cards('KhKdQcJs'))).toBe(false);
    expect(omahaReraisedPremium(cards('Jh9dTh8d'))).toBe(true);
    expect(omahaReraisedPremium(cards('Jh9cTh8s'))).toBe(false);
    expect(omahaReraisedPremium(cards('6h4d5h3d'))).toBe(false);
    expect(omahaReraisedPremium(cards('AsKdQs7d'))).toBe(false);
    expect(omahaReraisedPremium(cards('AsKdJs9d'))).toBe(false);
    expect(omahaReraisedPremium(cards('AhQdTs4c2h'))).toBe(false);
    expect(omahaReraisedPremium(cards('Jh9dTh8d2c'))).toBe(true);
  });

  it('weak made: one pair and two pair below top two; top two, sets and better are not', () => {
    const board = cards('Kh8s4d');
    expect(omahaReraisedWeakMade(cards('AsKd9h7c'), board)).toBe(true); // top pair
    expect(omahaReraisedWeakMade(cards('Ks4h9h7c'), board)).toBe(true); // top and bottom
    expect(omahaReraisedWeakMade(cards('KsQh8h7c'), board)).toBe(false); // top two
    expect(omahaReraisedWeakMade(cards('8h8c9h7c'), board)).toBe(false); // set
    expect(omahaReraisedWeakMade(cards('QsJh9h7c'), board)).toBe(false); // no pair
  });

  it('strong range: aces, or top two pair or better on the board', () => {
    const board = cards('Kh8s4d');
    expect(omahaReraisedStrongHand(cards('AhAd7c2s'), board)).toBe(true);
    expect(omahaReraisedStrongHand(cards('KsQh8h7c'), board)).toBe(true);
    expect(omahaReraisedStrongHand(cards('4h4c9h7c'), board)).toBe(true);
    expect(omahaReraisedStrongHand(cards('Ks4h9h7c'), board)).toBe(false);
  });

  it('equity is reproducible and in range', () => {
    const e1 = omahaReraisedEquity(cards('AsKdQs7d'), [], [], (h) => omahaReraisedPremium(h));
    const e2 = omahaReraisedEquity(cards('AsKdQs7d'), [], [], (h) => omahaReraisedPremium(h));
    expect(e1).toBe(e2);
    expect(e1).toBeGreaterThan(0.1);
    expect(e1).toBeLessThan(0.6);
  });
});

describe('the preflop cell', () => {
  it('ace-high broadway facing a 4-bet with chips behind folds without an equity test', () => {
    const v = omahaReraisedPreflopCell(pre({ stack: 900 }));
    expect(v).toMatchObject({ fold: true, cell: 'preflop', equity: null });
  });

  it('a committed call is priced against aces: folds a bad price, keeps a good one', () => {
    const bad = omahaReraisedPreflopCell(
      pre({ hole: cards('Qs9d6c3h'), toCall: 160, stack: 160, pot: 200 })
    );
    expect(bad?.fold).toBe(true);
    const good = omahaReraisedPreflopCell(pre({ toCall: 10, stack: 10, pot: 400 }));
    expect(good?.fold).toBe(false);
  });

  it('aces and premium structures, fewer than three raises, folds and checks are untouched', () => {
    expect(omahaReraisedPreflopCell(pre({ hole: cards('AhAd7c2s') }))).toBeNull();
    expect(omahaReraisedPreflopCell(pre({ hole: cards('Jh9dTh8d') }))).toBeNull();
    expect(omahaReraisedPreflopCell(pre({ preflopRaises: 2 }))).toBeNull();
    expect(omahaReraisedPreflopCell(pre({ action: 'fold' }))).toBeNull();
    expect(omahaReraisedPreflopCell(pre({ toCall: 0 }))).toBeNull();
    expect(omahaReraisedPreflopCell(pre({ action: 'raise', stack: 900 }))?.fold).toBe(true);
  });

  it('PLO6, hi-lo, more than one board, bomb pots, all-in-or-fold and tournaments are out of scope', () => {
    expect(
      omahaReraisedPreflopCell(pre({ variant: 'plo6', hole: cards('AsKdQs7d3c2h') }))
    ).toBeNull();
    expect(
      omahaReraisedPreflopCell(pre({ variant: 'plo5', hole: cards('AsKdQs7d3c') }))
    ).not.toBeNull();
    for (const k of ['hiLo', 'multiBoard', 'bombPot', 'tournament', 'allInOrFold'] as const)
      expect(omahaReraisedPreflopCell(pre({ [k]: true }))).toBeNull();
  });
});

describe('the postflop cell', () => {
  it('top pair calling off in a 4-bet pot: folds when it does not pay the price', () => {
    const v = omahaReraisedPostflopCell(post());
    expect(v?.fold).toBe(true);
    expect(v?.cell).toBe('postflop');
  });

  it('a token price is paid and kept', () => {
    const v = omahaReraisedPostflopCell(post({ toCall: 2, stack: 2, pot: 600 }));
    expect(v?.fold).toBe(false);
  });

  it('a call that does not commit the stack is left alone; a raise over the wager is judged', () => {
    expect(omahaReraisedPostflopCell(post({ stack: 2000 }))).toBeNull();
    expect(omahaReraisedPostflopCell(post({ stack: 2000, action: 'raise' }))?.fold).toBe(true);
  });

  it('top two, sets, no pair, an un-re-raised pot and the wrong board size are untouched', () => {
    expect(omahaReraisedPostflopCell(post({ hole: cards('KsQh8h7c') }))).toBeNull();
    expect(omahaReraisedPostflopCell(post({ hole: cards('8h8c9h7c') }))).toBeNull();
    expect(omahaReraisedPostflopCell(post({ hole: cards('QsJh9h7c') }))).toBeNull();
    expect(omahaReraisedPostflopCell(post({ preflopRaises: 2 }))).toBeNull();
    expect(omahaReraisedPostflopCell(post({ board: cards('Kh8s4d') }))).toBeNull();
  });
});

describe('in the league (anonymised seats)', () => {
  it('off by default: unset and false play the same poker', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `reraised_off_${variant}`,
          variant,
          pairs: 120,
          productionStyles: true,
          a: {},
          b: { omahaReraisedPotDiscipline: false },
        },
        120,
        4410001
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 300_000);

  it('on, the rule fires in both cells with receipts and changes play, with no illegal action', async () => {
    enableBrainTelemetry();
    drainFires();
    const fired: Record<string, number> = {};
    let divergent = 0;
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `reraised_on_${variant}`,
          variant,
          pairs: 300,
          productionStyles: true,
          a: {
            omahaReraisedPotDiscipline: true,
            omahaReraisedPotStackOffFold: true,
            telemetry: true,
          },
          b: { omahaReraisedPotDiscipline: false, telemetry: true },
        },
        300,
        4420001
      );
      divergent += r.divergentPairs ?? 0;
      expect(r.illegalActions).toBe(0);
      expect(r.brainExceptionFallbacks ?? 0).toBe(0);
      for (const f of drainFires())
        if (f.feature.startsWith('omaha_reraised_pot_'))
          fired[f.feature] = (fired[f.feature] ?? 0) + f.fires;
    }
    expect(fired.omaha_reraised_pot_preflop_fold ?? 0).toBeGreaterThan(0);
    expect(divergent).toBeGreaterThan(0);
  }, 300_000);
});

// A public PLO5 turn node (an anonymised complaint fixture) rewritten so the
// preflop action was open, 3-bet, 4-bet: the acting seat faces an all-in it
// can call for the rest of its stack, with the seat's cards replaced.
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
function fourBetTurn(hole: string, reraised = true) {
  const fx = JSON.parse(JSON.stringify(SET_LEADS)) as ComplaintFixture;
  if (reraised) {
    const threeBet = fx.actions.find((a) => a.ord === 6)!;
    Object.assign(threeBet, { action: 'raise', amount: 26, isFullRaise: true });
  }
  const node = fx.actions.find((a) => a.ord === 20)!;
  fx.hole[String(node.seat)] = cards(hole);
  return stateAt(fx, node);
}
function decideMany(s: ReturnType<typeof fourBetTurn>, opts: Record<string, unknown>) {
  enableBrainTelemetry();
  return SEEDS.map((seed) => {
    seedFastRandom(seed);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...opts,
    } as never);
    const fires = drainFires().map((f) => f.feature);
    return {
      action: d.action,
      amount: typeof d.amount === 'number' ? d.amount : null,
      fired: fires.includes('omaha_reraised_pot_postflop_fold'),
      next: fastRandom(),
    };
  });
}
const strip = (rs: ReturnType<typeof decideMany>) => rs.map((r) => [r.action, r.amount, r.next]);

describe('in the decision (turn of a 4-bet pot, call for the rest of the stack)', () => {
  it('two pair below top two and top pair: every call today makes becomes a fold with a receipt', () => {
    for (const hole of ['Td3d9c8h7s', 'AsQd9c8h7s']) {
      const s = fourBetTurn(hole);
      const off = decideMany(s, { omahaReraisedPotDiscipline: false });
      const on = decideMany(s, {
        omahaReraisedPotDiscipline: true,
        omahaReraisedPotStackOffFold: true,
      });
      expect(off.some((r) => r.action === 'call' || r.action === 'all_in')).toBe(true);
      on.forEach((r, i) => {
        if (off[i].action === 'call' || off[i].action === 'all_in') {
          expect(r.action).toBe('fold');
          expect(r.fired).toBe(true);
        } else expect([r.action, r.amount]).toEqual([off[i].action, off[i].amount]);
      });
      // The rule draws nothing from the brain's random stream.
      expect(on.map((r) => r.next)).toEqual(off.map((r) => r.next));
    }
  });

  it('top two pair, a made straight, and the same two pair in a pot raised only twice, are unchanged', () => {
    for (const hole of ['AsKd9c8h7s', 'QhJs9c8h7s']) {
      const s = fourBetTurn(hole);
      expect(
        strip(
          decideMany(s, { omahaReraisedPotDiscipline: true, omahaReraisedPotStackOffFold: true })
        )
      ).toEqual(strip(decideMany(s, { omahaReraisedPotDiscipline: false })));
    }
    const twice = fourBetTurn('Td3d9c8h7s', false);
    expect(
      strip(
        decideMany(twice, { omahaReraisedPotDiscipline: true, omahaReraisedPotStackOffFold: true })
      )
    ).toEqual(strip(decideMany(twice, { omahaReraisedPotDiscipline: false })));
  });

  it('off by default: unset and false decide the same and leave the stream where it was', () => {
    const s = fourBetTurn('Td3d9c8h7s');
    expect(strip(decideMany(s, { omahaReraisedPotDiscipline: false }))).toEqual(
      strip(decideMany(s, {}))
    );
  });
});

describe('the realistic stack-off range (omahaReraisedPotStackOffRealistic)', () => {
  it('holds aces or kings, top pair or better, and strong draws; not a low pair or air', () => {
    const board = cards('Kh8s4d');
    expect(omahaReraisedRealisticHand(cards('AhAd7c2s'), board)).toBe(true);
    expect(omahaReraisedRealisticHand(cards('QcQd7c2s'), cards('Jh8s4d'))).toBe(true); // overpair
    expect(omahaReraisedRealisticHand(cards('Ks9h7c2s'), board)).toBe(true); // top pair
    expect(omahaReraisedRealisticHand(cards('8h4c9h2c'), board)).toBe(true); // two pair
    expect(omahaReraisedRealisticHand(cards('AsJs7h2c'), cards('Kh8s4s'))).toBe(true); // nut flush draw
    expect(omahaReraisedRealisticHand(cards('9h3c7h2c'), board)).toBe(false); // nothing
    expect(omahaReraisedRealisticHand(cards('4h5c9h2c'), board)).toBe(false); // bottom pair
  });

  it('is wider than the declared range, so the same hand has more equity and folds less', () => {
    const declared = omahaReraisedPostflopCell(post());
    const realistic = omahaReraisedPostflopCell(post(), 'realistic');
    expect(declared?.fold).toBe(true);
    expect(realistic).not.toBeNull();
    expect(realistic!.equity!).toBeGreaterThan(declared!.equity ?? 0);
  });

  it('a measured over-bluffer keeps the call; the declared cell ignores the read', () => {
    expect(
      omahaReraisedPostflopCell({ ...post(), bettorOverBluffs: true }, 'realistic')
    ).toBeNull();
    expect(omahaReraisedPostflopCell({ ...post(), bettorOverBluffs: true })?.fold).toBe(true);
  });

  it('in the decision: off by default, and on it judges the same node with its own receipt', () => {
    const s = fourBetTurn('Td3d9c8h7s');
    const base = { omahaReraisedPotDiscipline: true };
    expect(strip(decideMany(s, { ...base, omahaReraisedPotStackOffRealistic: false }))).toEqual(
      strip(decideMany(s, base))
    );
    enableBrainTelemetry();
    seedFastRandom(1);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
      mind: false,
      telemetry: true,
      ...base,
      omahaReraisedPotStackOffRealistic: true,
    } as never);
    const fires = drainFires().map((f) => f.feature);
    if (d.action === 'fold') expect(fires).toContain('omaha_reraised_pot_realistic_fold');
    else expect(fires).toContain('omaha_reraised_pot_priced_in');
  });
});
