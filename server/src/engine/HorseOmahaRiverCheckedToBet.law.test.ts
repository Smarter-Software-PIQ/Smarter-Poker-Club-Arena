/**
 * LAW (omahaRiverCheckedToBetIsMeasured, default OFF; EMERG lane OFFENCE-BUILD 2026-11-20). In PLO4/PLO5 cash, on the
 * river, heads-up, with nothing to call and the opponent having checked, a Horse's final check becomes a bet only where
 * the bet priced on the measured response curve beats the check by more than its standard error. Nothing but a check
 * changes; every bet is legal under pot limit and admitted by the response validator; the current nuts are never folded;
 * no identity is read; a measured calling station is not bluffed; out of scope elsewhere; off is byte-identical.
 * Spots: the anonymised journaled river requests of HorseOmahaCheckedToBet.fixture.json (the opponent checked, the Horse closes), plus constructed hole cards (the nuts, air).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { scoreOmahaHi, seedFastRandom } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { replayProfiles } from './HorseComplaintReplay.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { horseDecisionReceiptRefusalForGates } from './horseDecision/responseValidation.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';
import {
  OMAHA_RIVER_CHECKED_TO_RESPONSE,
  omahaRiverCheckedToBet,
  omahaRiverCheckedToBetRule,
  omahaRiverCheckedToCurve,
  omahaRiverCheckedToSpot,
} from './HorseOmahaRiverCheckedToBet.js';
import RECORDED from './HorseOmahaCheckedToBet.fixture.json';

interface Spot {
  set: string;
  hero: SeatPlayer;
  gs: HorseGameStateV2;
  options: Record<string, string>;
}
const SPOTS = (RECORDED as unknown as { spots: Spot[] }).spots;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const key = (c: Card) => `${c.rank}:${c.suit}`;
const same = (d: HorseDecision) => d;

/** A heads-up river request where the Horse acts first: the recorded spot with the opponent's river check removed. */
function firstToAct(s: Spot): Spot {
  const c = copy(s);
  c.gs.actionHistory = (c.gs.actionHistory ?? []).filter(
    (a) => !(String(a.stage) === 'river' && a.seat !== c.hero.seat)
  );
  return c;
}
const RIVER = SPOTS.filter((s) => s.set === 'river_hu_checkback_air_weak');
void firstToAct;

function unseenDeck(board: Card[], dead: Card[] = []): Card[] {
  const used = new Set([...board, ...dead].map(key));
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (!used.has(`${rank}:${suit}`)) deck.push({ rank, suit } as Card);
  return deck;
}
/** Hero holds the exact current nuts (best two cards plus fillers). */
function withNuts(s: Spot): Spot {
  const c = copy(s);
  const board = c.gs.communityCards ?? [];
  const deck = unseenDeck(board);
  let best: Card[] = [];
  let top = -1;
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      const v = scoreOmahaHi([deck[i], deck[j]], board);
      if (v > top) {
        top = v;
        best = [deck[i], deck[j]];
      }
    }
  const taken = new Set(best.map(key));
  const fill = deck.filter((x) => !taken.has(key(x))).slice(-(c.hero.cards.length - 2));
  c.hero.cards = [...best, ...fill];
  c.hero.knownDeadCards = [];
  return c;
}
const check: HorseDecision = { action: 'check', thinkTime: 1 };

afterEach(() => {
  HorseMind.reset();
});

describe('omahaRiverCheckedToBetIsMeasured: registration and scope', () => {
  it('is registered dark and scopable per game', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaRiverCheckedToBetIsMeasured');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaRiverCheckedToBetIsMeasured');
  });

  it('the measured curve: continue falls and fold rises with size; the pooled cell backs up a thin variant cell', () => {
    for (const g of ['plo4', 'plo5', 'pooled'] as const) {
      const c = OMAHA_RIVER_CHECKED_TO_RESPONSE[g];
      expect(c.length).toBe(4);
      for (const p of c) {
        expect(p.cont).toBeGreaterThan(0);
        expect(p.cont).toBeLessThanOrEqual(1);
        expect(p.raise).toBeLessThanOrEqual(p.cont);
        expect(p.foldSe).toBeGreaterThan(0);
      }
      expect(c[3].cont).toBeLessThan(c[0].cont);
    }
    expect(omahaRiverCheckedToCurve('plo6')).toEqual(OMAHA_RIVER_CHECKED_TO_RESPONSE.pooled);
  });

  it('the recorded river spots, first to act, are in scope', () => {
    expect(RIVER.length).toBeGreaterThanOrEqual(5);
    for (const s of RIVER) expect(omahaRiverCheckedToSpot(s.hero, s.gs)).not.toBeNull();
  });

  const outside: Array<[string, (s: Spot) => void]> = [
    ['PLO6', (s) => void (s.gs.gameVariant = 'plo6')],
    ['PLO8', (s) => void (s.gs.gameVariant = 'plo8')],
    ['a tournament', (s) => void (s.gs.gameMode = 'tournament')],
    ['a bomb pot', (s) => void (s.gs.bombPot = true)],
    ['two boards', (s) => void (s.gs.boardCount = 2)],
    ['hi-lo', (s) => void (s.gs.variantRules = { ...s.gs.variantRules!, splitLow8OrBetter: true })],
    ['a bet to call', (s) => void (s.gs.toCall = 10)],
    [
      'the opponent has not acted (first to act: not this rule)',
      (s) => void (s.gs.actionHistory = firstToAct(s).gs.actionHistory),
    ],
    [
      'the turn',
      (s) => {
        s.gs.stage = 'turn';
        s.gs.communityCards = s.gs.communityCards!.slice(0, 4);
      },
    ],
    [
      'an opponent all in',
      (s) =>
        s.gs.players.forEach((p) => {
          if (p.seat !== s.hero.seat && !p.is_folded) p.is_all_in = true;
        }),
    ],
    [
      'multiway',
      (s) => {
        const extra = s.gs.players.find((p) => p.seat !== s.hero.seat && p.is_folded);
        if (extra) extra.is_folded = false;
        else s.gs.players.push({ ...copy(s.hero), seat: 99, user_id: 'seat-99', cards: [] });
      },
    ],
  ];
  it.each(outside)('%s is outside it and the rule returns the same object', (_n, change) => {
    const s = copy(RIVER[0]);
    expect(omahaRiverCheckedToSpot(s.hero, s.gs)).not.toBeNull();
    change(s);
    expect(omahaRiverCheckedToSpot(s.hero, s.gs)).toBeNull();
    expect(omahaRiverCheckedToBetRule(check, s.hero, s.gs, true, 0.05, same).decision).toBe(check);
  });
});

describe('omahaRiverCheckedToBetIsMeasured: the rule', () => {
  it('off, or any decision that is not a check: the same object', () => {
    for (const s of RIVER) {
      expect(omahaRiverCheckedToBetRule(check, s.hero, s.gs, false, 0.05, same).decision).toBe(
        check
      );
      for (const action of ['bet', 'call', 'fold', 'raise', 'all_in'] as const) {
        const d: HorseDecision = { action, amount: 5, thinkTime: 1 };
        expect(omahaRiverCheckedToBetRule(d, s.hero, s.gs, true, 0.05, same).decision).toBe(d);
      }
    }
  });

  it('a change is only check -> bet/all_in at a pot-limit-legal size, priced above the check by its error', () => {
    let priced = 0;
    for (const base of RIVER)
      for (const s of [base, withNuts(base)]) {
        const res = omahaRiverCheckedToBetRule(check, s.hero, s.gs, true, 0.05, same);
        if (res.priced) priced++;
        const d = res.decision;
        expect(['check', 'bet', 'all_in']).toContain(d.action);
        if (d.action === 'check') continue;
        expect(res.changed).toBe(true);
        const amt = d.amount as number;
        expect(amt).toBeGreaterThan(0);
        expect(amt).toBeLessThanOrEqual(s.hero.stack + 0.005);
        if (Number.isFinite(s.gs.maxRaiseTo))
          expect(amt).toBeLessThanOrEqual((s.gs.maxRaiseTo as number) + 0.005);
        if (d.action === 'bet' && Number.isFinite(s.gs.minRaiseTo))
          expect(amt).toBeGreaterThanOrEqual((s.gs.minRaiseTo as number) - 0.005);
        expect(amt).toBeLessThanOrEqual(s.gs.pot + 0.005);
        const v = res.verdict!;
        expect(v.best!.ev - v.evCheck).toBeGreaterThan(v.best!.error);
      }
    expect(priced).toBeGreaterThan(0);
  });

  it('the current nuts are never folded; called, they are priced at their full equity; a check stands only where it is worth as much', () => {
    for (const base of RIVER) {
      const s = withNuts(base);
      expect(hasRiverNuts(s.hero, s.gs, false)).toBe(true);
      const res = omahaRiverCheckedToBetRule(check, s.hero, s.gs, true, 0.05, same);
      expect(res.decision.action).not.toBe('fold');
      expect(res.priced).toBe(true);
      const v = res.verdict!;
      for (const row of v.rows) expect(row.equity).toBeGreaterThanOrEqual(0.5); // never behind: a chop at worst
      if (res.decision.action === 'check')
        for (const row of v.rows) expect(row.ev - v.evCheck).toBeLessThanOrEqual(row.error + 0.005);
    }
  });

  it('a measured calling station is not bluffed: with every hand continuing, air checks', () => {
    const s = copy(RIVER[0]);
    const spot = omahaRiverCheckedToSpot(s.hero, s.gs)!;
    const station = OMAHA_RIVER_CHECKED_TO_RESPONSE.pooled.map((p) => ({
      ...p,
      cont: 0.97,
      raise: 0.05,
    }));
    const v = omahaRiverCheckedToBet(s.hero, s.gs, spot, 0.05, station);
    expect(v).not.toBeNull();
    for (const row of v!.rows)
      if (row.equity < 0.3) expect(row.ev).toBeLessThan(v!.evCheck + row.error);
    expect(v!.action === 'check' || v!.best!.equity >= 0.3).toBe(true);
  });

  it('reads no identity: marking every player a person or a Horse, or renaming them, changes nothing', () => {
    for (const s of RIVER) {
      const a = copy(s);
      const b = copy(s);
      for (const p of a.gs.players) (p as { is_horse?: boolean }).is_horse = true;
      for (const p of b.gs.players) {
        (p as { is_horse?: boolean }).is_horse = false;
        (p as { user_id: string }).user_id = 'renamed-' + p.seat;
      }
      const ra = omahaRiverCheckedToBetRule(check, a.hero, a.gs, true, 0.05, same);
      const rb = omahaRiverCheckedToBetRule(check, b.hero, b.gs, true, 0.05, same);
      expect(rb.decision).toEqual(ra.decision);
    }
  });

  it('is deterministic', () => {
    for (const s of RIVER) {
      const a = omahaRiverCheckedToBetRule(check, s.hero, s.gs, true, 0.05, same);
      const b = omahaRiverCheckedToBetRule(check, copy(s.hero), copy(s.gs), true, 0.05, same);
      expect(b.decision).toEqual(a.decision);
    }
  });
});

describe('omahaRiverCheckedToBetIsMeasured: the decision', () => {
  const recorded = (s: Spot): HorseDecideOpts => {
    const o: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(s.options))
      if (v === 'on' || v === 'off') o[k] = v === 'on';
    return o as HorseDecideOpts;
  };
  const decide = (s: Spot, extra: Record<string, unknown>, seed: number) => {
    const c = copy(s);
    HorseMind.reset();
    seedFastRandom(seed);
    seedHorseTimingRandom(seed);
    return HorseLogic.decide(c.hero, c.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...recorded(s),
      ...extra,
    } as never);
  };
  const strip = (d: HorseDecision) => {
    const x = withoutMeasurements(d) as Record<string, unknown>;
    delete x.thinkTime;
    return x;
  };

  it('off is byte-identical to the option absent', () => {
    for (const s of [...RIVER, ...RIVER.map(withNuts)])
      for (const seed of [1, 2]) {
        const a = decide(s, {}, seed);
        const b = decide(s, { omahaRiverCheckedToBetIsMeasured: false }, seed);
        expect(strip(b)).toEqual(strip(a));
      }
  });

  it('on: never folds with nothing to call, every bet is legal and admitted by the response validator', () => {
    let wagers = 0;
    for (const s of [...RIVER, ...RIVER.map(withNuts)])
      for (const seed of [1, 2]) {
        const d = decide(s, { omahaRiverCheckedToBetIsMeasured: true }, seed);
        expect(d.action).not.toBe('fold');
        if (d.action === 'bet' || d.action === 'all_in') {
          wagers++;
          const refusal = horseDecisionReceiptRefusalForGates(
            structuredClone(d),
            String(s.gs.gameVariant),
            { player: s.hero, gameState: s.gs } as never,
            [false],
            [false]
          );
          expect(refusal).toBeNull();
          const amt = d.amount ?? s.hero.stack;
          expect(amt).toBeLessThanOrEqual(Math.min(s.hero.stack, s.gs.pot) + 0.005);
        }
      }
    expect(wagers).toBeGreaterThan(0);
  });

  it('PLO6 is untouched: on and off decide alike', () => {
    for (const base of RIVER.slice(0, 3)) {
      const s = copy(base);
      s.gs.gameVariant = 'plo6';
      s.hero.cards = [...s.hero.cards, unseenDeck(s.gs.communityCards ?? [], s.hero.cards)[0]];
      const a = decide(s, {}, 1);
      const b = decide(s, { omahaRiverCheckedToBetIsMeasured: true }, 1);
      expect(strip(b)).toEqual(strip(a));
    }
  });

  it('sits before the river current-nuts floor at the outermost of the wager_rules node', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'HorseLogic.ts'),
      'utf8'
    );
    const rule = src.indexOf('const checkedTo2 = omahaRiverCheckedToBetRule(');
    expect(rule).toBeGreaterThan(src.indexOf('const openMeasured = omahaOpenMeasuredRule('));
    expect(rule).toBeGreaterThan(src.indexOf('const firstToAct = omahaRiverFirstToActBetRule('));
    expect(
      src.indexOf('omahaRiverCurrentNutsCallFloorRule(\n        checkedTo2.decision')
    ).toBeGreaterThan(rule);
    expect(src.indexOf("decision = graph.run('wager_rules'")).toBeGreaterThan(rule);
  });
});
