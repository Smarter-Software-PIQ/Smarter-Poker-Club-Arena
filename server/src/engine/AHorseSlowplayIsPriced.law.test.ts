/**
 * LAW: H4 MONSTER SLOWPLAY MIX IS PRICED DETERMINISTICALLY WHEN `horseSlowplayIsPriced` IS ON,
 * AND BYTE-IDENTICAL WHEN OFF OR OUTSIDE NON-OMAHA / NON-FIXED-LIMIT SCOPE (2026-11-22).
 *
 * Criteria: CRITERIA-H4-SLOWPLAY-PRICED.md (HORSE DECISIONS lane); r2 (measured inputs):
 * CRITERIA-H4-SLOWPLAY-PRICED-R2.md; r3 (2026-11-28, every street left, people-measured inputs):
 * CRITERIA-SLOWPLAY2-01Gw7aDq.md.
 *
 * Invariants proven here:
 *   1. OFF / unset / false is 100% byte-identical to origin/main, including exact `fastRandom()`
 *      consumption and next-draw RNG state.
 *   2. Omaha (`plo4`, `plo5`, `plo6`) and Fixed-Limit (`flh`) are 100% untouched even when
 *      `horseSlowplayIsPriced: true` (identical action, amount, RNG state, zero slowplay-priced
 *      receipts).
 *   3. Pure pricing module `HorseSlowplayPriced.ts` is deterministic (zero `fastRandom()` draw),
 *      public-info-only (zero opponent hole cards, zero `opponentHud/` import), and satisfies
 *      monotonicity:
 *        - higher opponent fold-to-bet rate `F` favors check (raises `evCheck - evBet`);
 *        - higher opponent `betWhenCheckedTo` rate `B` favors check (raises `evCheck - evBet`);
 *        - r2: no free-card constant, the called branch uses the equity against the continuing
 *          range `e ^ (1 + kappa * F / (1 - F))` with the measured NLH `kappa` (non-increasing in
 *          `F`);
 *        - multiway (`oppCount = 2`) multiplies fold probabilities (`F_1 * F_2`);
 *        - r2b/r2c: a stab is charged only by opponents who act after the Horse; none: the stab
 *          probability is 0 and, with one street priced, `EV(check) = e * P` exactly;
 *        - tournament `heroBubbleFactor > 1` scales the `(1 - e) * wager` loss side while
 *          `bf = 1` reduces identically to `e * (P + 2 * w) - w`;
 *        - r3: EVERY STREET LEFT IS PRICED (3 on the flop, 2 on the turn): one street priced is
 *          the closed form, and the later streets change the verdict (a check against an opponent
 *          who folds too much, a bigger lead for the bet against one who does not fold); the
 *          inputs are measured from real people and pinned with their provenance (the rate of
 *          betting into an unbet pot by street, by who bet last and by lead / checked to; the bet
 *          size as quantiles, each capped by the stack before the mean; the raise share and size);
 *          equity is conserved over every opponent choice; where nothing is measured the pricing
 *          leans to the bet (a wet board is never checked; an opponent's record never raises the
 *          later streets' betting above the people's rate); one verdict visits at most
 *          `SLOWPLAY_MAX_TREE_NODES` tree nodes.
 *   4. End-to-end `HorseLogic.decide` with `horseSlowplayIsPriced: true` is deterministic across
 *      RNG seeds on the check-vs-bet decision and emits `horse_slowplay_priced_checked` on a
 *      priced slowplay check and `horse_slowplay_priced_bet` on a priced value bet. r3: the call
 *      site reads who bet last on the street before from the public action history.
 *   5. `horseSlowplayIsPriced` stays strictly dark in `OPTION_SWITCH_REFUSED` (never registered
 *      in `OPTION_SWITCH_NAMES`, zero SQL migrations).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { _clearGtoPostflop } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { freshExploitCounters } from './HorseOpponentExploit.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_REFUSED,
  optionSwitchRefusal,
} from './HorseOptionSwitch.js';
import { NLH_REFERENCE_CONTINUATION_SHARPNESS } from './HorseShortDeckMultiwayPriced.js';
import {
  classifyHoldemFlopTexture,
  priceMonsterSlowplay,
  riskAdjustedCallUtility,
  slowplayCalledEquity,
  slowplayEquityAroundOpponentBet,
  slowplayPeopleBetSize,
  SLOWPLAY_MAX_TREE_NODES,
  SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES,
  SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES,
  SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE,
  SLOWPLAY_PEOPLE_UNBET_POT_BET,
  SLOWPLAY_PRICED_PROVENANCE,
  SLOWPLAY_WET_BOARD_GATE,
  type PriceMonsterSlowplayInput,
  type SlowplayOpponentInput,
} from './HorseSlowplayPriced.js';
import { conditionEquityAgainstRaiseCallRange } from './holdemEmpiricalPriors.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
/** r3 cost bounds (relative only): the applicable decision on over off; the whole tree over one street. */
const RATIO_DECISION_ON_OVER_OFF = 2;
const RATIO_TREE_OVER_ONE_STREET = 75;
const SUITS: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]!]! });
  }
  return out;
}

function firesMap(): Record<string, number> {
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
}

function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  hole = '',
  folded = false
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_all_in: false,
    is_sitting_out: false,
  };
}

function monsterFlopState(opts: {
  variant?: 'nlh' | 'plo4' | 'plo5' | 'plo6' | 'flh';
  heroHole?: string;
  board?: string;
  oppId?: string;
  pot?: number;
  stack?: number;
  street?: 'flop' | 'turn';
  /** r2b: hero out of position (the opponent has the button and acts after the hero postflop). */
  heroOop?: boolean;
}) {
  const variant = opts.variant ?? 'nlh';
  const heroId = 'horse-h4-hero';
  const oppId = opts.oppId ?? '10000000-0000-4000-8000-0000000000a1';
  const pot = opts.pot ?? 60;
  const stack = opts.stack ?? 400;
  const street = opts.street ?? 'flop';
  const heroHole =
    opts.heroHole ??
    (variant === 'plo4'
      ? 'KhKdAsQc'
      : variant === 'plo5'
        ? 'KhKdAsQcJc'
        : variant === 'plo6'
          ? 'KhKdAsQcJcTs'
          : 'KhKd');
  const boardStr = opts.board ?? (street === 'turn' ? 'Ks7d2c2h' : 'Ks7d2c');
  const hero = seat(2, heroId, stack, 0, 30, heroHole);
  const opp = seat(1, oppId, stack, 0, 30);
  const gs = {
    handNumber: 777101,
    stage: street,
    pot,
    currentBet: 0,
    minRaise: 2,
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: opts.heroOop ? 1 : 2,
    gameVariant: variant,
    format: 'cash',
    communityCards: cards(boardStr),
    players: [opp, hero],
    actionHistory: opts.heroOop
      ? [
          { stage: 'preflop', seat: 1, userId: oppId, action: 'raise', amount: 6 },
          { stage: 'preflop', seat: 2, userId: heroId, action: 'call', amount: 6 },
          ...(street === 'turn'
            ? [
                { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0 },
                { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0 },
              ]
            : []),
        ]
      : [
          { stage: 'preflop', seat: 2, userId: heroId, action: 'raise', amount: 6 },
          { stage: 'preflop', seat: 1, userId: oppId, action: 'call', amount: 6 },
          { stage: 'flop', seat: 1, userId: oppId, action: 'check', amount: 0 },
          ...(street === 'turn'
            ? [
                { stage: 'flop', seat: 2, userId: heroId, action: 'check', amount: 0 },
                { stage: 'turn', seat: 1, userId: oppId, action: 'check', amount: 0 },
              ]
            : []),
        ],
  };
  return { hero, opp, oppId, gs };
}

function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  return {
    action: d.action,
    amount: d.amount ?? null,
    thinkTime: d.thinkTime,
    continuationGuard: d.continuationGuard ?? null,
  };
}

describe('LAW: horseSlowplayIsPriced (H4 Monster Slowplay Mix Priced Replacement)', () => {
  beforeEach(() => {
    HorseMind.reset();
    _clearGtoPostflop();
    _clearGtoPostflopV31();
    enableBrainTelemetry();
    drainFires();
  });

  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  describe('pure pricing invariants & public-info discipline', () => {
    const baseInput: PriceMonsterSlowplayInput = {
      equity: 0.92,
      pot: 100,
      candidateBet: 80,
      effectiveStack: 400,
      oppCount: 1,
      wetness: 0.12,
      street: 'flop',
      // Out of position: an opponent still acts after a check, so a stab can come (r2b).
      inPosition: false,
      spr: 4,
      flopTexture: 'unpaired_nonmono',
      heroBubbleFactor: 1,
    };
    const STREETS = ['flop', 'turn', 'river'] as const;

    it('contains zero fastRandom calls and zero opponentHud imports', () => {
      const raw = readFileSync(join(REPO, 'server/src/engine/HorseSlowplayPriced.ts'), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\bfastRandom\s*\(/);
      expect(code).not.toMatch(/from\s+['"][^'"]*opponentHud\//);
    });

    it('is 100% deterministic and never consumes fastRandom()', () => {
      seedFastRandom(12345);
      const r1 = priceMonsterSlowplay(baseInput);
      const nextAfter1 = fastRandom();

      seedFastRandom(12345);
      const nextWithoutCall = fastRandom();
      expect(nextAfter1).toBe(nextWithoutCall);

      seedFastRandom(999999);
      const r2 = priceMonsterSlowplay(baseInput);
      expect(r2).toEqual(r1);
    });

    it('riskAdjustedCallUtility reduces identically to e*(P+2w)-w at bf=1 and scales the loss side when bf>1', () => {
      const e = 0.85;
      const p = 100;
      const w = 75;
      expect(riskAdjustedCallUtility(e, p, w, 1)).toBeCloseTo(e * (p + 2 * w) - w, 10);
      const u1 = riskAdjustedCallUtility(e, p, w, 1);
      const u15 = riskAdjustedCallUtility(e, p, w, 1.5);
      const u2 = riskAdjustedCallUtility(e, p, w, 2.0);
      expect(u15).toBeLessThan(u1);
      expect(u2).toBeLessThan(u15);
      expect(u1 - u15).toBeCloseTo((1 - e) * 0.5 * w, 10);
    });

    it('higher opponent fold rate favors check; lower fold rate favors bet', () => {
      const sticky = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 6], 'f.betCk': [40, 26] } } }],
      });
      const folder = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 36], 'f.betCk': [40, 26] } } }],
      });
      expect(folder.foldProb).toBeGreaterThan(sticky.foldProb);
      expect(folder.evCheck - folder.evBet).toBeGreaterThan(sticky.evCheck - sticky.evBet);
      expect(sticky.action).toBe('bet');
      expect(folder.action).toBe('check');
      expect(folder.reason).toBe('ev_check_exceeds_ev_bet');
      expect(sticky.reason).toBe('ev_bet_exceeds_or_equals_ev_check');
    });

    it('higher opponent betWhenCheckedTo favors check; lower betWhenCheckedTo favors bet', () => {
      const passive = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 16], 'f.betCk': [40, 4] } } }],
      });
      const stabber = priceMonsterSlowplay({
        ...baseInput,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 16], 'f.betCk': [40, 34] } } }],
      });
      expect(stabber.stabProb).toBeGreaterThan(passive.stabProb);
      expect(stabber.evCheck - stabber.evBet).toBeGreaterThan(passive.evCheck - passive.evBet);
      expect(passive.action).toBe('bet');
      expect(stabber.action).toBe('check');
    });

    it('r3: pins its people-measured inputs with provenance (bet rates, bet sizes, raises) and the NLH continuation sharpness', () => {
      for (const table of [
        SLOWPLAY_PEOPLE_UNBET_POT_BET,
        SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES,
        SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES,
        SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE,
        SLOWPLAY_PRICED_PROVENANCE,
      ]) {
        expect(Object.isFrozen(table)).toBe(true);
      }
      // people's rate of betting into an unbet pot: hits / n per street, last bettor, lead / checked to
      const cells: Record<string, [number, number, number, number]> = {
        'flop.none': [79, 336, 177, 527],
        'flop.other': [278, 3117, 331, 1461],
        'flop.self': [214, 323, 956, 1385],
        'turn.none': [328, 1110, 252, 890],
        'turn.other': [66, 925, 102, 338],
        'turn.self': [279, 402, 398, 702],
        'river.none': [259, 842, 207, 891],
        'river.other': [51, 397, 66, 196],
        'river.self': [234, 363, 183, 331],
      };
      for (const street of STREETS) {
        for (const who of ['none', 'other', 'self'] as const) {
          const cell = SLOWPLAY_PEOPLE_UNBET_POT_BET[street][who];
          const [lh, ln, ch, cn] = cells[`${street}.${who}`]!;
          expect([cell.lead.hits, cell.lead.n, cell.checkedTo.hits, cell.checkedTo.n]).toEqual([
            lh,
            ln,
            ch,
            cn,
          ]);
          expect(cell.lead.rate).toBe(lh / ln);
          expect(cell.checkedTo.rate).toBe(ch / cn);
          // adequate sample in every cell
          expect(Math.min(cell.lead.n, cell.checkedTo.n)).toBeGreaterThanOrEqual(196);
        }
        // the person who bet last bets again far more often than the one who called
        expect(SLOWPLAY_PEOPLE_UNBET_POT_BET[street].self.lead.rate).toBeGreaterThan(
          3 * SLOWPLAY_PEOPLE_UNBET_POT_BET[street].other.lead.rate
        );
        const qs = SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES[street];
        expect(qs).toHaveLength(20);
        expect([...qs].sort((a, b) => a - b)).toEqual([...qs]);
        expect(qs[0]).toBeGreaterThan(0);
      }
      // medians (the mean of the two middle midpoints) as measured: 0.5000, 0.5099, 0.5238
      const mid = (s: (typeof STREETS)[number]) =>
        (SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES[s][9]! + SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES[s][10]!) /
        2;
      expect(mid('flop')).toBeCloseTo(0.5, 2);
      expect(mid('turn')).toBeCloseTo(0.51, 2);
      expect(mid('river')).toBeCloseTo(0.526, 2);
      expect(SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES.flop.rate).toBe(324 / 1806);
      expect(SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES.turn.rate).toBe(163 / 1041);
      expect(SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES.river.rate).toBe(79 / 470);
      expect(SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE).toEqual({ flop: 3.479, turn: 2.835, river: 3.0 });
      expect(SLOWPLAY_PRICED_PROVENANCE.sample).toContain("game_variant = 'nlh'");
      expect(SLOWPLAY_PRICED_PROVENANCE.sample).toContain('has_human');
      expect(SLOWPLAY_PRICED_PROVENANCE.sample).toContain('Horse actions excluded');
      expect(SLOWPLAY_PRICED_PROVENANCE.sample).toContain('2026-10-19T00:00Z..2026-11-28T06:00Z');
      expect(SLOWPLAY_PRICED_PROVENANCE.betSize).toContain('flop n 2035 (78 people)');
      expect(SLOWPLAY_PRICED_PROVENANCE.betSize).toContain('turn n 1425 (73 people)');
      expect(SLOWPLAY_PRICED_PROVENANCE.betSize).toContain('river n 1000 (76 people)');
      expect(SLOWPLAY_PRICED_PROVENANCE.criteria).toContain('CRITERIA-SLOWPLAY2-01Gw7aDq.md');
      expect(NLH_REFERENCE_CONTINUATION_SHARPNESS.flop).toBe(0.3151);
      expect(NLH_REFERENCE_CONTINUATION_SHARPNESS.turn).toBe(0.4068);
      expect(NLH_REFERENCE_CONTINUATION_SHARPNESS.river).toBe(0.9415);
    });

    it("r3: an opponent's bet is sized from the people's quantiles, each capped by the stack before the mean", () => {
      for (const street of STREETS) {
        const qs = SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES[street];
        const mean = qs.reduce((a, b) => a + b, 0) / qs.length;
        // deep: the plain mean of the midpoints
        expect(slowplayPeopleBetSize(street, 100, 1e9)).toBeCloseTo(mean * 100, 9);
        // half a pot behind: every bet above half pot is that stack, not more
        const half = qs.reduce((a, b) => a + Math.min(0.5, b), 0) / qs.length;
        expect(slowplayPeopleBetSize(street, 100, 50)).toBeCloseTo(half * 100, 9);
        expect(slowplayPeopleBetSize(street, 100, 50)).toBeLessThan(
          Math.min(50, slowplayPeopleBetSize(street, 100, 1e9))
        );
        // never more than the stack; nothing to bet with or into is no bet
        expect(slowplayPeopleBetSize(street, 100, 3)).toBe(3);
        expect(slowplayPeopleBetSize(street, 0, 50)).toBe(0);
        expect(slowplayPeopleBetSize(street, 100, 0)).toBe(0);
      }
      for (const street of ['flop', 'turn'] as const) {
        const r = priceMonsterSlowplay({ ...baseInput, street, pot: 100, effectiveStack: 400 });
        expect(r.stabSize).toBeCloseTo(slowplayPeopleBetSize(street, 100, 400), 10);
        const capped = priceMonsterSlowplay({ ...baseInput, street, pot: 100, effectiveStack: 20 });
        expect(capped.stabSize).toBeLessThanOrEqual(20);
        expect(capped.stabSize).toBeCloseTo(slowplayPeopleBetSize(street, 100, 20), 10);
      }
    });

    it("r3: equity is conserved over an opponent's bet: the betting range is stronger, the range that did not bet weaker by as much", () => {
      for (const street of STREETS) {
        for (const e of [0.6, 0.82, 0.9, 0.97]) {
          for (const q of [0.07, 0.23, 0.34, 0.57, 0.69, 0.9]) {
            const a = slowplayEquityAroundOpponentBet(e, q, street);
            expect(a.vsBet).toBeLessThan(e);
            expect(a.vsNoBet).toBeGreaterThan(e);
            expect(a.vsNoBet).toBeLessThanOrEqual(1);
            if (a.vsNoBet < 1) expect(q * a.vsBet + (1 - q) * a.vsNoBet).toBeCloseTo(e, 12);
            expect(a.vsBet).toBeCloseTo(
              Math.pow(e, 1 + (NLH_REFERENCE_CONTINUATION_SHARPNESS[street] * (1 - q)) / q),
              12
            );
          }
          // an opponent who never bets, or always bets, tells nothing
          expect(slowplayEquityAroundOpponentBet(e, 0, street)).toEqual({ vsBet: e, vsNoBet: e });
          expect(slowplayEquityAroundOpponentBet(e, 1, street)).toEqual({ vsBet: e, vsNoBet: e });
        }
      }
    });

    it('r3: one street priced (maxStreets 1) is the closed form: fold, call or raise against stab or nothing', () => {
      const opp: SlowplayOpponentInput = {
        hudOpp: { eff: { 'f.fb.bg.hu': [40, 22], 'f.betCk': [40, 22] } },
      };
      for (const bf of [1, 1.8]) {
        const r = priceMonsterSlowplay({
          ...baseInput,
          heroBubbleFactor: bf,
          opponents: [opp],
          maxStreets: 1,
        });
        expect(r.streetsPriced).toBe(1);
        const P = 100;
        const b = 80;
        const F = r.foldProb;
        expect(r.effectiveBet).toBe(b);
        expect(r.calledEquity).toBeCloseTo(slowplayCalledEquity(0.92, F / (1 - F), 'flop'), 12);
        const rho = SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES.flop.rate;
        const raiseTo = Math.min(400, SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE.flop * b);
        expect(r.evBet).toBeCloseTo(
          F * P +
            (1 - F) *
              ((1 - rho) * riskAdjustedCallUtility(r.calledEquity, P, b, bf) +
                rho * riskAdjustedCallUtility(r.calledEquity, P, raiseTo, bf)),
          9
        );
        const A = r.stabProb;
        const s = slowplayPeopleBetSize('flop', P, 400);
        expect(r.stabSize).toBeCloseTo(s, 12);
        const around = slowplayEquityAroundOpponentBet(0.92, A, 'flop');
        expect(r.evCheck).toBeCloseTo(
          A * Math.max(0, riskAdjustedCallUtility(around.vsBet, P, s, bf)) +
            (1 - A) * around.vsNoBet * P,
          9
        );
      }
    });

    it('r3: prices every street left (3 on the flop, 2 on the turn); what one street missed changes the verdict', () => {
      expect(priceMonsterSlowplay(baseInput).streetsPriced).toBe(3);
      expect(priceMonsterSlowplay({ ...baseInput, street: 'turn' }).streetsPriced).toBe(2);
      expect(priceMonsterSlowplay({ ...baseInput, maxStreets: 9 }).streetsPriced).toBe(3);
      expect(priceMonsterSlowplay({ ...baseInput, maxStreets: 0 }).streetsPriced).toBe(1);
      expect(
        priceMonsterSlowplay({ ...baseInput, street: 'turn', maxStreets: 3 }).streetsPriced
      ).toBe(2);

      const spot: PriceMonsterSlowplayInput = {
        equity: 0.9,
        pot: 100,
        candidateBet: 75,
        effectiveStack: 900,
        oppCount: 1,
        wetness: 0.1,
        street: 'flop',
        inPosition: false,
        spr: 9,
        flopTexture: 'unpaired_nonmono',
        initiative: 'hero',
      };
      const counters = (foldToBet: number, betCheckedTo: number): SlowplayOpponentInput => ({
        exploitCounters: { foldToBet, foldToBetOpp: 60, betCheckedTo, betCheckedToOpp: 60 },
      });
      // An opponent who folds three bets in four: one street sees a fold now against one stab and
      // bets; every street sees the value bets the check keeps alive, and checks.
      const folder = counters(45, 20);
      const one = priceMonsterSlowplay({ ...spot, opponents: [folder], maxStreets: 1 });
      const all = priceMonsterSlowplay({ ...spot, opponents: [folder] });
      expect(one.action).toBe('bet');
      expect(all.action).toBe('check');
      expect(all.evCheck).toBeGreaterThan(one.evCheck);
      // Against an opponent who does not fold, the later streets belong to the bet: the called bet
      // builds the pot the turn and river bets are sized from. The bet's lead GROWS with the streets.
      const station = counters(2, 2);
      const one2 = priceMonsterSlowplay({ ...spot, opponents: [station], maxStreets: 1 });
      const two2 = priceMonsterSlowplay({ ...spot, opponents: [station], maxStreets: 2 });
      const all2 = priceMonsterSlowplay({ ...spot, opponents: [station] });
      expect(all2.action).toBe('bet');
      expect(two2.evBet).toBeGreaterThan(one2.evBet);
      expect(all2.evBet).toBeGreaterThan(two2.evBet);
      expect(all2.evBet - all2.evCheck).toBeGreaterThan(one2.evBet - one2.evCheck);
      // the same decision street inputs in both: only the horizon differs
      expect(all.foldProb).toBe(one.foldProb);
      expect(all.stabProb).toBe(one.stabProb);
      expect(all.stabSize).toBe(one.stabSize);
    });

    it("r3: the stab rate is the people's rate for who bet last on the street before (the Horse, the opponent, nobody)", () => {
      for (const street of ['flop', 'turn'] as const) {
        const cell = SLOWPLAY_PEOPLE_UNBET_POT_BET[street];
        const at = (initiative: 'hero' | 'opp' | 'none' | undefined, oppCount = 1) =>
          priceMonsterSlowplay({ ...baseInput, street, initiative, oppCount }).stabProb;
        // the Horse bet last: the opponent is the caller, checked to
        expect(at('hero')).toBeCloseTo(cell.other.checkedTo.rate, 12);
        // the opponent bet last: it has the lead, checked to
        expect(at('opp')).toBeCloseTo(cell.self.checkedTo.rate, 12);
        expect(at('none')).toBeCloseTo(cell.none.checkedTo.rate, 12);
        expect(at(undefined)).toBe(at('none'));
        expect(at('opp')).toBeGreaterThan(at('none'));
        // two opponents and the last bet theirs: whose it was is not known, both at the lower rate
        expect(at('opp', 2)).toBeCloseTo(1 - (1 - cell.none.checkedTo.rate) ** 2, 12);
        expect(at('hero', 2)).toBeCloseTo(1 - (1 - cell.other.checkedTo.rate) ** 2, 12);
      }
      // checking to the opponent who bet last is worth more than checking to a caller
      const toRaiser = priceMonsterSlowplay({ ...baseInput, initiative: 'opp' });
      const toCaller = priceMonsterSlowplay({ ...baseInput, initiative: 'hero' });
      expect(toRaiser.evCheck).toBeGreaterThan(toCaller.evCheck);
      expect(toRaiser.evBet).toBe(toCaller.evBet);
    });

    it("r3 leans to the bet where nothing is measured: a wet board is never checked, and an opponent's record never raises the later streets' betting above the people's rate", () => {
      const raw = readFileSync(join(REPO, 'server/src/engine/HorseSlowplayPriced.ts'), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      // no free-card constant came back
      expect(code).not.toMatch(/freeCardPenalty|freeCardEquity|SLOWPLAY_STAB_POT_FRAC\b/);
      expect(code).not.toMatch(/\b0\.55\b/);
      expect(SLOWPLAY_WET_BOARD_GATE).toBe(0.5);

      const opp: SlowplayOpponentInput = {
        hudOpp: { eff: { 'f.fb.bg.hu': [40, 34], 'f.betCk': [40, 28] } },
      };
      const dry = priceMonsterSlowplay({ ...baseInput, wetness: 0.1, opponents: [opp] });
      const nearly = priceMonsterSlowplay({ ...baseInput, wetness: 0.49, opponents: [opp] });
      const none = priceMonsterSlowplay({ ...baseInput, wetness: undefined, opponents: [opp] });
      expect(dry.action).toBe('check');
      expect(nearly).toEqual(dry);
      expect(none).toEqual(dry);
      expect(dry.checkEquity).toBe(baseInput.equity);
      for (const wetness of [0.5, 0.85, 1]) {
        const wet = priceMonsterSlowplay({ ...baseInput, wetness, opponents: [opp] });
        expect(wet.action).toBe('bet');
        expect(wet.reason).toBe('wet_board_not_priced');
        // the prices are the same: only the verdict is held to the bet
        expect(wet.evCheck).toBe(dry.evCheck);
        expect(wet.evBet).toBe(dry.evBet);
      }
      // a wet board where the bet wins anyway keeps the ordinary reason
      expect(priceMonsterSlowplay({ ...baseInput, wetness: 0.9 }).reason).toBe(
        'ev_bet_exceeds_or_equals_ev_check'
      );

      // The Horse last to act on the turn: no stab can come on this street, so the opponent's
      // bet-when-checked-to record only reaches the river. A record ABOVE the pool changes nothing
      // there; a record below it does.
      const ipTurn: PriceMonsterSlowplayInput = {
        ...baseInput,
        street: 'turn',
        inPosition: true,
        effectiveStack: 900,
      };
      const record = (betCheckedTo: number): SlowplayOpponentInput => ({
        canStab: false,
        exploitCounters: { foldToBet: 0, foldToBetOpp: 0, betCheckedTo, betCheckedToOpp: 60 },
      });
      const pool = priceMonsterSlowplay({ ...ipTurn, opponents: [{ canStab: false }] });
      const aggressive = priceMonsterSlowplay({ ...ipTurn, opponents: [record(55)] });
      const passive = priceMonsterSlowplay({ ...ipTurn, opponents: [record(2)] });
      expect(pool.stabProb).toBe(0);
      expect(aggressive.evCheck).toBe(pool.evCheck);
      expect(aggressive.evBet).toBe(pool.evBet);
      expect(passive.evCheck).not.toBeCloseTo(pool.evCheck, 6);
      // on the decision street the same record is used in full
      const oop = (o: SlowplayOpponentInput) =>
        priceMonsterSlowplay({
          ...ipTurn,
          inPosition: false,
          opponents: [{ ...o, canStab: true }],
        });
      expect(oop(record(55)).stabProb).toBeGreaterThan(oop({}).stabProb);
      expect(oop(record(2)).stabProb).toBeLessThan(oop({}).stabProb);
    });

    it('r3: one verdict visits a bounded number of tree nodes (the live decide path stays cheap)', () => {
      expect(SLOWPLAY_MAX_TREE_NODES).toBe(125);
      let most = 0;
      const opps: SlowplayOpponentInput[][] = [
        [{}],
        [{ canStab: false }],
        [{}, {}],
        [{ canStab: false }, {}],
        [{ canStab: false }, { canStab: false }],
        [{}, { canRespond: false }],
      ];
      for (const street of ['flop', 'turn'] as const) {
        for (const initiative of ['hero', 'opp', 'none'] as const) {
          for (const opponents of opps) {
            for (const effectiveStack of [30, 400, 5000]) {
              for (const candidateBet of [33, 80, 150]) {
                const r = priceMonsterSlowplay({
                  ...baseInput,
                  street,
                  initiative,
                  opponents,
                  oppCount: opponents.length,
                  effectiveStack,
                  candidateBet,
                });
                expect(r.nodes).toBeGreaterThan(1);
                expect(r.nodes).toBeLessThanOrEqual(SLOWPLAY_MAX_TREE_NODES);
                if (street === 'turn') expect(r.nodes).toBeLessThanOrEqual(25);
                expect(Number.isFinite(r.evCheck) && Number.isFinite(r.evBet)).toBe(true);
                most = Math.max(most, r.nodes);
              }
            }
          }
        }
      }
      // the bound is reached (a flop with a player on each side of the Horse), so it is the bound
      expect(most).toBe(SLOWPLAY_MAX_TREE_NODES);
      expect(priceMonsterSlowplay({ ...baseInput, maxStreets: 1 }).nodes).toBeLessThanOrEqual(5);
    });

    it('conditions the called equity on the continuing range: e^(1 + kappa * meanG), measured kappa, non-increasing in meanG', () => {
      for (const street of STREETS) {
        expect(slowplayCalledEquity(0.9, 0, street)).toBe(0.9);
        let prev = 1;
        for (const f of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95]) {
          const g = f / (1 - f);
          const ec = slowplayCalledEquity(0.9, g, street);
          expect(ec).toBeLessThanOrEqual(prev);
          expect(ec).toBeLessThanOrEqual(0.9);
          expect(ec).toBeCloseTo(
            Math.pow(0.9, 1 + NLH_REFERENCE_CONTINUATION_SHARPNESS[street] * g),
            12
          );
          expect(ec).toBeCloseTo(
            conditionEquityAgainstRaiseCallRange(0.9, f, {
              sharpness: NLH_REFERENCE_CONTINUATION_SHARPNESS[street],
            }),
            12
          );
          prev = ec;
        }
      }
      const opp = (folds: number): SlowplayOpponentInput => ({
        hudOpp: { eff: { 'f.fb.bg.hu': [40, folds], 'f.betCk': [40, 20] } },
      });
      const lowF = priceMonsterSlowplay({ ...baseInput, opponents: [opp(8)] });
      const highF = priceMonsterSlowplay({ ...baseInput, opponents: [opp(34)] });
      expect(highF.foldProb).toBeGreaterThan(lowF.foldProb);
      expect(highF.calledEquity).toBeLessThan(lowF.calledEquity);
      expect(lowF.calledEquity).toBeLessThan(baseInput.equity);
      // heads-up: meanG = F / (1 - F)
      expect(highF.calledEquity).toBeCloseTo(
        slowplayCalledEquity(0.92, highF.foldProb / (1 - highF.foldProb), 'flop'),
        12
      );
    });

    it('r2c: a stab is charged only by opponents who act after the Horse (canStab); none -> stabProb 0 and, one street priced, EV(check) = e * P', () => {
      const stabber = (betCk: number, canStab?: boolean): SlowplayOpponentInput => ({
        hudOpp: {
          eff: { 'f.fb.bg.hu': [40, 30], 'f.fb.bg.mw': [40, 30], 'f.betCk': [40, betCk] },
        },
        ...(canStab === undefined ? {} : { canStab }),
      });
      for (const street of ['flop', 'turn'] as const) {
        for (const bf of [1, 2.2]) {
          // Horse last to act: nobody can stab, whatever the position flag says
          for (const inPosition of [true, false]) {
            for (const opps of [[stabber(34, false)], [stabber(34, false), stabber(30, false)]]) {
              const input: PriceMonsterSlowplayInput = {
                ...baseInput,
                street,
                inPosition,
                heroBubbleFactor: bf,
                oppCount: opps.length,
                opponents: opps,
              };
              const last = priceMonsterSlowplay(input);
              expect(last.stabProb).toBe(0);
              expect(last.action).toBe(last.evCheck > last.evBet ? 'check' : 'bet');
              // the check closes the street: with only this street priced it is a free showdown
              const oneStreet = priceMonsterSlowplay({ ...input, maxStreets: 1 });
              expect(oneStreet.stabProb).toBe(0);
              expect(oneStreet.evCheck).toBe(baseInput.equity * baseInput.pot);
              // with the later streets priced, a check that closes the street still has its value
              // bets to come: it is worth more than the free showdown
              if (bf === 1) expect(last.evCheck).toBeGreaterThan(oneStreet.evCheck);
            }
          }
          // Opp1 checked -> Horse -> Opp2: only Opp2 is charged
          const mid = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            oppCount: 2,
            opponents: [stabber(36, false), stabber(6, true)],
          });
          const opp2Only = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            oppCount: 2,
            opponents: [stabber(6, true), stabber(36, false)],
          });
          const both = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            oppCount: 2,
            opponents: [stabber(36, true), stabber(6, true)],
          });
          const hu2 = priceMonsterSlowplay({
            ...baseInput,
            street,
            heroBubbleFactor: bf,
            opponents: [stabber(6, true)],
          });
          expect(mid.stabProb).toBeCloseTo(hu2.stabProb, 12);
          expect(opp2Only.stabProb).toBeCloseTo(hu2.stabProb, 12);
          expect(both.stabProb).toBeGreaterThan(mid.stabProb);
          // fold side is unchanged by who can stab
          expect(mid.foldProb).toBeCloseTo(both.foldProb, 12);
          expect(mid.calledEquity).toBeCloseTo(both.calledEquity, 12);
        }
      }
      // in position no longer silences the stab by itself: an opponent still to act is charged
      const ipWithStabber = priceMonsterSlowplay({
        ...baseInput,
        inPosition: true,
        opponents: [stabber(34, true)],
      });
      expect(ipWithStabber.stabProb).toBeGreaterThan(0);
    });

    it('multiway: fold probabilities multiply over the field; the called equity uses the per-opponent mean g (as kappa was measured)', () => {
      const opp: SlowplayOpponentInput = {
        hudOpp: {
          eff: { 'f.fb.bg.hu': [40, 32], 'f.fb.bg.mw': [40, 32], 'f.betCk': [40, 24] },
        },
      };
      const hu = priceMonsterSlowplay({ ...baseInput, oppCount: 1, opponents: [opp] });
      const mw = priceMonsterSlowplay({ ...baseInput, oppCount: 2, opponents: [opp, opp] });
      const fi = hu.foldProb;
      expect(mw.foldProb).toBeCloseTo(fi * fi, 6);
      // two identical opponents: meanG = g_i, so the called equity equals the heads-up one
      expect(mw.calledEquity).toBeCloseTo(hu.calledEquity, 10);
      // the field version (g = F / (1 - F), F = fi^2) would under-condition: it is NOT used
      const fieldG = (fi * fi) / (1 - fi * fi);
      expect(mw.calledEquity).toBeLessThan(slowplayCalledEquity(0.92, fieldG, 'flop'));
      expect(mw.stabProb).toBeGreaterThan(hu.stabProb);
      // different opponents: mean of the per-opponent odds
      const loose: SlowplayOpponentInput = {
        hudOpp: { eff: { 'f.fb.bg.hu': [40, 8], 'f.fb.bg.mw': [40, 8], 'f.betCk': [40, 24] } },
      };
      const huLoose = priceMonsterSlowplay({ ...baseInput, oppCount: 1, opponents: [loose] });
      const mixed = priceMonsterSlowplay({ ...baseInput, oppCount: 2, opponents: [opp, loose] });
      const gA = hu.foldProb / (1 - hu.foldProb);
      const gB = huLoose.foldProb / (1 - huLoose.foldProb);
      expect(mixed.calledEquity).toBeCloseTo(slowplayCalledEquity(0.92, (gA + gB) / 2, 'flop'), 10);
      // an all-in seat enters with g = 0
      const withAllIn = priceMonsterSlowplay({
        ...baseInput,
        oppCount: 2,
        opponents: [opp, { canRespond: false }],
      });
      expect(withAllIn.foldProb).toBe(0);
      expect(withAllIn.calledEquity).toBeCloseTo(slowplayCalledEquity(0.92, gA / 2, 'flop'), 10);
    });

    it('bubble factor scales the losing branch: chips at risk are worth less on every priced street, never more', () => {
      const spot: PriceMonsterSlowplayInput = {
        ...baseInput,
        equity: 0.84,
        candidateBet: 120,
        wetness: 0.05,
        opponents: [{ hudOpp: { eff: { 'f.fb.bg.hu': [40, 14], 'f.betCk': [40, 12] } } }],
      };
      for (const maxStreets of [1, 2, 3]) {
        const cash = priceMonsterSlowplay({ ...spot, heroBubbleFactor: 1.0, maxStreets });
        const bubble = priceMonsterSlowplay({ ...spot, heroBubbleFactor: 2.2, maxStreets });
        expect(bubble.bubbleFactor).toBe(2.2);
        expect(bubble.evBet).toBeLessThan(cash.evBet);
        expect(bubble.evCheck).toBeLessThan(cash.evCheck);
        // null / below 1 is chip EV
        expect(priceMonsterSlowplay({ ...spot, heroBubbleFactor: null, maxStreets })).toEqual(cash);
        expect(priceMonsterSlowplay({ ...spot, heroBubbleFactor: 0.4, maxStreets })).toEqual(cash);
      }
    });

    it('handles degenerate pot/stack safely and classifies public flop textures', () => {
      expect(priceMonsterSlowplay({ ...baseInput, pot: 0 }).reason).toBe('degenerate_pot_or_stack');
      expect(priceMonsterSlowplay({ ...baseInput, effectiveStack: 0 }).reason).toBe(
        'degenerate_pot_or_stack'
      );
      expect(classifyHoldemFlopTexture(cards('Ks7s2s'))).toBe('mono');
      expect(classifyHoldemFlopTexture(cards('KsKd2c'))).toBe('paired');
      expect(classifyHoldemFlopTexture(cards('Ks7d2c'))).toBe('unpaired_nonmono');
    });
  });

  describe('end-to-end HorseLogic.decide scope, OFF-identity, determinism, and receipts', () => {
    it('OFF (unset and false) is 100% byte-identical including exact fastRandom() sequence', () => {
      const { hero, gs } = monsterFlopState({ variant: 'nlh' });
      for (const seed of [1, 7, 42, 101, 555]) {
        seedFastRandom(seed);
        const unsetDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
          telemetry: true,
        });
        const rngAfterUnset = fastRandom();
        const firesUnset = firesMap();

        seedFastRandom(seed);
        const falseDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
          telemetry: true,
          horseSlowplayIsPriced: false,
        });
        const rngAfterFalse = fastRandom();
        const firesFalse = firesMap();

        expect(stableDecision(falseDec)).toEqual(stableDecision(unsetDec));
        expect(rngAfterFalse).toBe(rngAfterUnset);
        expect(firesFalse).toEqual(firesUnset);
        expect(firesFalse['horse_slowplay_priced_checked']).toBeUndefined();
        expect(firesFalse['horse_slowplay_priced_bet']).toBeUndefined();
      }
    });

    it.each(['plo4', 'plo5', 'plo6', 'flh'] as const)(
      '%s is 100% untouched even when horseSlowplayIsPriced: true (including RNG sequence and zero receipts)',
      (variant) => {
        const { hero, gs } = monsterFlopState({ variant });
        for (const seed of [1, 7, 42]) {
          seedFastRandom(seed);
          const offDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            telemetry: true,
            horseSlowplayIsPriced: false,
          });
          const rngOff = fastRandom();
          drainFires();

          seedFastRandom(seed);
          const onDec = HorseLogic.decide(hero, gs as never, 'balanced', undefined, {
            telemetry: true,
            horseSlowplayIsPriced: true,
          });
          const rngOn = fastRandom();
          const firesOn = firesMap();

          expect(stableDecision(onDec)).toEqual(stableDecision(offDec));
          expect(rngOn).toBe(rngOff);
          expect(firesOn['horse_slowplay_priced_checked']).toBeUndefined();
          expect(firesOn['horse_slowplay_priced_bet']).toBeUndefined();
        }
      }
    );

    it('fires horse_slowplay_priced_checked deterministically against a high-fold high-stab opponent and horse_slowplay_priced_bet against a sticky passive opponent', () => {
      const oppTrapId = '10000000-0000-4000-8000-0000000000b1';
      const oppValueId = '10000000-0000-4000-8000-0000000000b2';
      HorseMind.importDurableOpponentProfiles([
        {
          user_id: oppTrapId,
          variant: 'nlh',
          mode: 'cash',
          size: 'hu',
          observed_hands: 80,
          initialized: true,
          counters: {
            ...freshExploitCounters(),
            hands: 80,
            vpip: 40,
            pfr: 24,
            foldToBetOpp: 60,
            foldToBet: 55,
            betCheckedToOpp: 60,
            betCheckedTo: 54,
          },
        },
        {
          user_id: oppValueId,
          variant: 'nlh',
          mode: 'cash',
          size: 'hu',
          observed_hands: 80,
          initialized: true,
          counters: {
            ...freshExploitCounters(),
            hands: 80,
            vpip: 60,
            pfr: 10,
            foldToBetOpp: 60,
            foldToBet: 6,
            betCheckedToOpp: 60,
            betCheckedTo: 6,
          },
        },
      ]);

      const commonOpts: HorseDecideOpts = {
        telemetry: true,
        observeMind: false,
        v38Ev: false,
        v29GtoFlop: false,
        v30GtoTurnRiver: false,
        horseSlowplayIsPriced: true,
      };

      // r2b: the priced slowplay check needs a player still to act after the check (out of position).
      const trapSpot = monsterFlopState({
        variant: 'nlh',
        street: 'turn',
        heroHole: '7h7c',
        board: 'Ks7d2c9h',
        oppId: oppTrapId,
        heroOop: true,
      });
      for (const seed of [1, 7, 42, 99]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          trapSpot.hero,
          trapSpot.gs as never,
          'balanced',
          undefined,
          commonOpts
        );
        const fires = firesMap();
        expect(dec.action).toBe('check');
        expect(fires['horse_slowplay_priced_checked']).toBe(1);
        expect(fires['horse_slowplay_priced_bet']).toBeUndefined();
      }

      const valueSpot = monsterFlopState({
        variant: 'nlh',
        street: 'turn',
        heroHole: '7h7c',
        board: 'Ks7d2c9h',
        oppId: oppValueId,
      });
      for (const seed of [1, 7, 42, 99]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          valueSpot.hero,
          valueSpot.gs as never,
          'balanced',
          undefined,
          commonOpts
        );
        const fires = firesMap();
        expect(['bet', 'all_in']).toContain(dec.action);
        expect(fires['horse_slowplay_priced_bet']).toBe(1);
        expect(fires['horse_slowplay_priced_checked']).toBeUndefined();
      }
    });
  });

  it('r2c end-to-end: who can stab is read from seat order, not from the street-IQ position read', () => {
    const trapId = '10000000-0000-4000-8000-0000000000c1';
    const passiveId = '10000000-0000-4000-8000-0000000000c2';
    const profile = (user_id: string, foldToBet: number, betCheckedTo: number) => ({
      user_id,
      variant: 'nlh' as const,
      mode: 'cash' as const,
      size: 'hu' as const,
      observed_hands: 80,
      initialized: true,
      counters: {
        ...freshExploitCounters(),
        hands: 80,
        vpip: 40,
        pfr: 20,
        foldToBetOpp: 60,
        foldToBet,
        betCheckedToOpp: 60,
        betCheckedTo,
      },
    });
    HorseMind.importDurableOpponentProfiles([profile(trapId, 42, 54), profile(passiveId, 42, 2)]);
    const opts = (streetIQ: boolean): HorseDecideOpts => ({
      telemetry: true,
      observeMind: false,
      v38Ev: false,
      v29GtoFlop: false,
      v30GtoTurnRiver: false,
      streetIQ,
      horseSlowplayIsPriced: true,
    });
    // Heads-up, the Horse on the button acts last on the turn after the stabber checked: nobody
    // can stab its check, with the street-IQ read on or off (off, the position read is false).
    const last = monsterFlopState({
      variant: 'nlh',
      street: 'turn',
      heroHole: '7h7c',
      board: 'Ks7d2c9h',
      oppId: trapId,
    });
    for (const streetIQ of [true, false]) {
      for (const seed of [1, 7, 42]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          last.hero,
          last.gs as never,
          'balanced',
          undefined,
          opts(streetIQ)
        );
        const fires = firesMap();
        expect(fires['horse_slowplay_priced_bet']).toBe(1);
        expect(fires['horse_slowplay_priced_checked']).toBeUndefined();
        expect(dec.action).not.toBe('check');
      }
    }
    // Out of position against the same stabber (it acts after the Horse): the stab is charged and
    // the priced check wins, with the street-IQ read on or off.
    const first = monsterFlopState({
      variant: 'nlh',
      street: 'turn',
      heroHole: '7h7c',
      board: 'Ks7d2c9h',
      oppId: trapId,
      heroOop: true,
    });
    for (const streetIQ of [true, false]) {
      for (const seed of [1, 7, 42]) {
        seedFastRandom(seed);
        const dec = HorseLogic.decide(
          first.hero,
          first.gs as never,
          'balanced',
          undefined,
          opts(streetIQ)
        );
        const fires = firesMap();
        expect(fires['horse_slowplay_priced_checked']).toBe(1);
        expect(dec.action).toBe('check');
      }
    }
  });

  it('r3: the every-street pricing is reachable only behind horseSlowplayIsPriced === true, and the call site hands it who bet last', () => {
    const raw = readFileSync(join(REPO, 'server/src/engine/HorseLogic.ts'), 'utf8');
    // one pricer call, inside the one priced-decision function
    expect(raw.match(/\bpriceMonsterSlowplay\(/g)).toHaveLength(1);
    const fnAt = raw.indexOf('function horseSlowplayPricedDecision(');
    const fnEnd = raw.indexOf('\n}\n', fnAt);
    const pricerAt = raw.indexOf('priceMonsterSlowplay({');
    expect(fnAt).toBeGreaterThan(0);
    expect(pricerAt).toBeGreaterThan(fnAt);
    expect(pricerAt).toBeLessThan(fnEnd);
    // one call of that function, inside the block the option guards with === true; the blanket
    // coin flip is the else branch, untouched
    const calls = [...raw.matchAll(/\bhorseSlowplayPricedDecision\(/g)].map((m) => m.index!);
    expect(calls).toHaveLength(2); // the declaration and the one call
    const callAt = calls[1]!;
    const guardAt = raw.lastIndexOf(
      'if (opts.horseSlowplayIsPriced === true && !vi.isOmaha && !vi.isFixedLimit) {',
      callAt
    );
    expect(guardAt).toBeGreaterThan(0);
    const between = raw.slice(guardAt, callAt);
    expect(between).not.toContain('} else');
    expect(raw.slice(callAt, callAt + 1500)).toContain('fastRandom() < params.slowplayFreq &&');
    // r3: who bet last on the street before is read from the public action history and passed on
    const body = raw.slice(fnAt, fnEnd);
    expect(body).toContain("const priorStage = street === 'flop' ? 'preflop' : 'flop';");
    expect(body).toContain('initiative: lastBettor,');
    expect(body).not.toMatch(/\bfastRandom\s*\(/);
    expect(body).not.toMatch(/\.cards\b/);
  });

  it('r3: the applicable decision with the option on costs about what it costs with it off (relative cost, never milliseconds)', () => {
    // WORKER-RULES SPEED form (src/testing/relativeCost.ts): the same applicable decisions, on
    // against off, alternating rounds, fastest round of each. Measured on this tree: 1.08 to 1.17
    // (about 0.11 ms a decision off, Apple Silicon under load); the whole tree against one street 30 to 31.
    // One verdict is at most SLOWPLAY_MAX_TREE_NODES closed-form nodes (about 30 microseconds for
    // the widest flop tree), against a decision that runs its own equity read.
    const opts = (on: boolean): HorseDecideOpts => ({
      observeMind: false,
      v38Ev: false,
      v29GtoFlop: false,
      v30GtoTurnRiver: false,
      horseSlowplayIsPriced: on,
    });
    const spots = [
      monsterFlopState({ variant: 'nlh' }),
      monsterFlopState({ variant: 'nlh', street: 'turn', heroHole: '7h7c', board: 'Ks7d2c9h' }),
      monsterFlopState({
        variant: 'nlh',
        street: 'turn',
        heroHole: '7h7c',
        board: 'Ks7d2c9h',
        heroOop: true,
      }),
    ];
    // every spot reaches the priced verdict with the option on
    enableBrainTelemetry();
    for (const sp of spots) {
      drainFires();
      seedFastRandom(11);
      HorseLogic.decide(sp.hero, sp.gs as never, 'balanced', undefined, {
        ...opts(true),
        telemetry: true,
      });
      const f = firesMap();
      expect(
        (f['horse_slowplay_priced_bet'] ?? 0) + (f['horse_slowplay_priced_checked'] ?? 0)
      ).toBe(1);
    }
    const run = (on: boolean) => () => {
      for (let i = 0; i < 40; i++) {
        for (const sp of spots) {
          seedFastRandom(1000 + i);
          HorseLogic.decide(sp.hero, sp.gs as never, 'balanced', undefined, opts(on));
        }
      }
    };
    const cost = measureRelativeCost(run(true), run(false), { rounds: 9 });
    expect(cost.ratio).toBeLessThan(RATIO_DECISION_ON_OVER_OFF);
    // and the pricer alone: every street against one street of the same spot (the code it replaced
    // priced one street)
    const input: PriceMonsterSlowplayInput = {
      equity: 0.9,
      pot: 100,
      candidateBet: 75,
      effectiveStack: 5000,
      oppCount: 2,
      street: 'flop',
      inPosition: false,
      opponents: [{ canStab: false }, {}],
    };
    const widest = priceMonsterSlowplay(input);
    expect(widest.nodes).toBe(125);
    expect(SLOWPLAY_MAX_TREE_NODES).toBe(125);
    const tree = measureRelativeCost(
      () => {
        for (let i = 0; i < 400; i++) priceMonsterSlowplay({ ...input, pot: 100 + (i % 9) });
      },
      () => {
        for (let i = 0; i < 400; i++)
          priceMonsterSlowplay({ ...input, pot: 100 + (i % 9), maxStreets: 1 });
      },
      { rounds: 9 }
    );
    // 125 nodes against 5: the whole tree may not cost more than its node count explains
    expect(tree.ratio).toBeLessThan(RATIO_TREE_OVER_ONE_STREET);
    // and it IS the every-street tree: one street alone is several times cheaper
    expect(tree.ratio).toBeGreaterThan(2);
  });

  it('r3 end-to-end: the call site reads who bet last on the street before from the public action history', () => {
    // An opponent whose record sits between the two cases (fixture tuned to the pinned tables:
    // fold-to-bet 30..32 of 60 gives the same pair of verdicts). Out of position on the flop the
    // Horse checks to it. The only difference between the two hands is the action before the flop.
    const oppId = '10000000-0000-4000-8000-0000000000d1';
    const heroId = 'horse-h4-hero';
    HorseMind.importDurableOpponentProfiles([
      {
        user_id: oppId,
        variant: 'nlh',
        mode: 'cash',
        size: 'hu',
        observed_hands: 80,
        initialized: true,
        counters: {
          ...freshExploitCounters(),
          hands: 80,
          vpip: 40,
          pfr: 20,
          foldToBetOpp: 60,
          foldToBet: 31,
          betCheckedToOpp: 60,
          betCheckedTo: 40,
        },
      },
    ]);
    const opts: HorseDecideOpts = {
      telemetry: true,
      observeMind: false,
      v38Ev: false,
      v29GtoFlop: false,
      v30GtoTurnRiver: false,
      horseSlowplayIsPriced: true,
    };
    const flop = (preflop: unknown[]) => {
      const hero = seat(2, heroId, 900, 0, 30, '7h7c');
      const opp = seat(1, oppId, 900, 0, 30);
      const gs = {
        handNumber: 777101,
        stage: 'flop',
        pot: 100,
        currentBet: 0,
        minRaise: 2,
        bigBlind: 2,
        smallBlind: 1,
        dealerSeat: 1,
        gameVariant: 'nlh',
        format: 'cash',
        communityCards: cards('Ks7d2c'),
        players: [opp, hero],
        actionHistory: preflop,
      };
      return { hero, gs };
    };
    // The Horse raised before the flop: the opponent is a caller, and a caller checked to seldom
    // bets (people: 331 of 1,461). The bet is priced higher.
    const heroRaised = flop([
      { stage: 'preflop', seat: 2, userId: heroId, action: 'raise', amount: 6 },
      { stage: 'preflop', seat: 1, userId: oppId, action: 'call', amount: 6 },
    ]);
    // Nobody raised before the flop: checked to, people bet more often (177 of 527). The check is
    // priced higher.
    const nobodyRaised = flop([
      { stage: 'preflop', seat: 1, userId: oppId, action: 'call', amount: 2 },
      { stage: 'preflop', seat: 2, userId: heroId, action: 'check', amount: 0 },
    ]);
    for (const seed of [1, 7, 42]) {
      seedFastRandom(seed);
      const bet = HorseLogic.decide(
        heroRaised.hero,
        heroRaised.gs as never,
        'balanced',
        undefined,
        opts
      );
      const betFires = firesMap();
      expect(bet.action).not.toBe('check');
      expect(betFires['horse_slowplay_priced_bet']).toBe(1);
      expect(betFires['horse_slowplay_priced_checked']).toBeUndefined();

      seedFastRandom(seed);
      const check = HorseLogic.decide(
        nobodyRaised.hero,
        nobodyRaised.gs as never,
        'balanced',
        undefined,
        opts
      );
      const checkFires = firesMap();
      expect(check.action).toBe('check');
      expect(checkFires['horse_slowplay_priced_checked']).toBe(1);
      expect(checkFires['horse_slowplay_priced_bet']).toBeUndefined();
    }
  });

  describe('3-way all-in opponent handling (audit Finding #6)', () => {
    it('treats an all-in opponent (canRespond=false) as never folding and never stabbing', () => {
      const base = {
        equity: 0.9,
        pot: 200,
        candidateBet: 120,
        effectiveStack: 400,
        oppCount: 2,
        wetness: 0.1,
        street: 'flop' as const,
        inPosition: false,
        flopTexture: 'unpaired_nonmono' as const,
        spr: 2,
        bubbleFactor: 1,
      };
      const livePassive = {
        canRespond: true,
        exploitCounters: {
          foldToBet: 45,
          foldToBetOpp: 50,
          betCheckedTo: 2,
          betCheckedToOpp: 50,
        },
      };
      const allInAggro = {
        canRespond: false,
        exploitCounters: {
          foldToBet: 45,
          foldToBetOpp: 50,
          betCheckedTo: 48,
          betCheckedToOpp: 50,
        },
      };
      const withAllIn = priceMonsterSlowplay({
        ...base,
        opponents: [livePassive, allInAggro],
      });
      const allInNoCounters = priceMonsterSlowplay({
        ...base,
        opponents: [livePassive, { canRespond: false }],
      });
      // An all-in seat cannot fold (so hero cannot take the pot uncontested: foldProb === 0)
      expect(withAllIn.foldProb).toBe(0);
      // An all-in seat cannot stab when checked to, so its historical betCheckedTo never inflates stabProb
      expect(withAllIn.stabProb).toBeCloseTo(allInNoCounters.stabProb, 10);
      expect(withAllIn.stabProb).toBeLessThan(0.25);
    });
  });

  describe('zero-migration OPTION_SWITCH_REFUSED governance', () => {
    it('keeps horseSlowplayIsPriced refused and unregistered in the SQL switch', () => {
      expect(Object.hasOwn(OPTION_SWITCH_REFUSED, 'horseSlowplayIsPriced')).toBe(true);
      expect(optionSwitchRefusal('horseSlowplayIsPriced')).toBeTruthy();
      expect(OPTION_SWITCH_NAMES).not.toContain('horseSlowplayIsPriced');
    });
  });
});
