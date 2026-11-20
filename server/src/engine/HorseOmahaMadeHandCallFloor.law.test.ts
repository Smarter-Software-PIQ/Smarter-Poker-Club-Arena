/**
 * LAW (omahaMadeHandCallFloor, default OFF; EMERG lane RIVER-FLOOR 2026-11-20): in PLO4/PLO5
 * cash, heads-up on the turn or river facing the street's first bet of more than half the pot up
 * to 1.05 pots, no Horse folds a made hand in the measured cells: the final fold becomes the legal
 * call for the exact chips owed (all in when the call is the stack). The floor changes only a fold,
 * reads public information only and no identity, is admitted by the response validator only where
 * it holds, and is byte-identical off, multiway, facing a raise, outside the size window, in PLO6,
 * PLO8, tournaments, bomb pots and multi-board hands. Recorded spots are named by hand id only
 * (anonymised fixtures, HorseOmahaFacingBetEv.test-support.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, HorseDecision } from '../types.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { RECORDED_FACING_BETS, expand } from './HorseOmahaFacingBetEv.test-support.js';
import {
  OMAHA_MADE_HAND_CALL_FLOOR_CELLS,
  omahaMadeHandCallFloorAdmitsCall,
  omahaMadeHandCallFloorRule,
  omahaMadeHandCallSpot,
  omahaMadeHandClass,
} from './HorseOmahaMadeHandCallFloor.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const key = (c: Card) => `${c.rank}:${c.suit}`;
const legalCall = (d: HorseDecision) => d;
const CELLS = [...OMAHA_MADE_HAND_CALL_FLOOR_CELLS];

function base(r: (typeof RECORDED_FACING_BETS)[number]) {
  const { fx, node } = expand(r);
  return stateAt(fx, node);
}
const paired = (b: Card[]) => new Set(b.map((c) => c.rank)).size < b.length;
/** Deterministic search: hero cards (the recorded count) whose class on this board is `cls`. */
function holeFor(board: Card[], n: number, cls: string, seed: number): Card[] | null {
  const used = new Set(board.map(key));
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (!used.has(`${rank}:${suit}`)) deck.push({ rank, suit } as Card);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 4000; t++) {
    const d = [...deck];
    const h: Card[] = [];
    for (let i = 0; i < n; i++) h.push(d.splice(Math.floor(rnd() * d.length), 1)[0]);
    if (omahaMadeHandClass(h, board) === cls) return h;
  }
  return null;
}
/** Recorded heads-up first-bet spots in the size window, each with hero holding a hand of an IN cell. */
let memo: Array<{ st: ReturnType<typeof base>; cell: string }> | null = null;
function inCellSpots() {
  if (memo) return memo.map((x) => ({ st: structuredClone(x.st), cell: x.cell }));
  const out: Array<{ st: ReturnType<typeof base>; cell: string }> = [];
  for (const r of RECORDED_FACING_BETS) {
    for (const cell of CELLS) {
      const [street, cls, bp] = cell.split('|');
      const st = base(r);
      if (st.gs.stage !== street) continue;
      const board = st.gs.communityCards ?? [];
      if (paired(board) !== (bp === 'bp')) continue;
      const h = holeFor(board, st.hero.cards.length, cls, r.n % 9973);
      if (!h) continue;
      st.hero.cards = h;
      st.hero.knownDeadCards = [];
      if (omahaMadeHandCallSpot(st.hero, st.gs)) out.push({ st, cell });
    }
  }
  memo = out;
  return out.map((x) => ({ st: structuredClone(x.st), cell: x.cell }));
}

describe('omahaMadeHandCallFloor: the floor', () => {
  it('is registered dark and scopable per game', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaMadeHandCallFloor');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaMadeHandCallFloor');
    expect(CELLS.length).toBeGreaterThan(0);
  });

  it('turns a fold in an IN cell into the call for the exact chips owed; never anything else', () => {
    const spots = inCellSpots();
    expect(spots.length).toBeGreaterThan(0);
    for (const { st, cell } of spots) {
      const spot = omahaMadeHandCallSpot(st.hero, st.gs)!;
      expect(spot.cell).toBe(cell);
      expect(spot.frac).toBeGreaterThan(0.5);
      expect(spot.frac).toBeLessThanOrEqual(1.05);
      const fold: HorseDecision = { action: 'fold', thinkTime: 1 };
      const out = omahaMadeHandCallFloorRule(fold, st.hero, st.gs, true, legalCall);
      expect(out.action).toBe('call');
      expect(out.amount).toBe(spot.paid);
      expect(omahaMadeHandCallFloorAdmitsCall(st.hero, st.gs, spot.paid)).toBe(true);
      expect(omahaMadeHandCallFloorAdmitsCall(st.hero, st.gs, spot.paid + 1)).toBe(false);
      expect(omahaMadeHandCallFloorRule(fold, st.hero, st.gs, false, legalCall)).toBe(fold);
      for (const action of ['call', 'raise', 'all_in', 'check'] as const) {
        const d: HorseDecision = { action, amount: 5, thinkTime: 1 };
        expect(omahaMadeHandCallFloorRule(d, st.hero, st.gs, true, legalCall)).toBe(d);
      }
    }
  });

  it('never acts outside the IN cells (every recorded hand as dealt)', () => {
    for (const r of RECORDED_FACING_BETS) {
      const st = base(r);
      const spot = omahaMadeHandCallSpot(st.hero, st.gs);
      if (!spot) continue;
      expect(OMAHA_MADE_HAND_CALL_FLOOR_CELLS.has(spot.cell)).toBe(true);
    }
  });

  it('is out of scope in PLO6, PLO8, tournaments, bomb pots, two boards, the flop and facing no wager', () => {
    const [first] = inCellSpots();
    expect(first).toBeDefined();
    const mutations: Array<(g: Record<string, unknown>) => void> = [
      (g) => (g.gameVariant = 'plo6'),
      (g) => (g.gameVariant = 'plo8'),
      (g) => (g.gameMode = 'tournament'),
      (g) => (g.bombPot = true),
      (g) => (g.boardCount = 2),
      (g) => (g.stage = 'flop'),
      (g) => (g.toCall = 0),
    ];
    for (const mutate of mutations) {
      const st = structuredClone(first.st);
      mutate(st.gs as unknown as Record<string, unknown>);
      expect(omahaMadeHandCallSpot(st.hero, st.gs)).toBeNull();
      const fold: HorseDecision = { action: 'fold', thinkTime: 1 };
      expect(omahaMadeHandCallFloorRule(fold, st.hero, st.gs, true, legalCall)).toBe(fold);
    }
  });

  it('is out of scope multiway and when hero already has chips in on the street (a raise)', () => {
    const [first] = inCellSpots();
    const multi = structuredClone(first.st);
    const other = multi.gs.players.find((p) => p.seat !== multi.hero.seat && p.is_folded);
    if (other) {
      other.is_folded = false;
      expect(omahaMadeHandCallSpot(multi.hero, multi.gs)).toBeNull();
    }
    const raised = structuredClone(first.st);
    raised.hero.bet = 1;
    expect(omahaMadeHandCallSpot(raised.hero, raised.gs)).toBeNull();
  });

  it('a short stack calls all in for its stack', () => {
    const [first] = inCellSpots();
    const st = structuredClone(first.st);
    st.hero.stack = Math.max(0.5, Math.floor(st.gs.toCall! / 2));
    const spot = omahaMadeHandCallSpot(st.hero, st.gs);
    expect(spot).not.toBeNull();
    expect(spot!.allIn).toBe(true);
    expect(spot!.paid).toBe(st.hero.stack);
  });

  it('reads no identity: marking every opponent a person or a Horse changes nothing', () => {
    for (const { st } of inCellSpots()) {
      const a = structuredClone(st);
      const b = structuredClone(st);
      for (const p of a.gs.players) (p as { is_horse?: boolean }).is_horse = true;
      for (const p of b.gs.players) (p as { is_horse?: boolean }).is_horse = false;
      expect(omahaMadeHandCallSpot(a.hero, a.gs)).toEqual(omahaMadeHandCallSpot(b.hero, b.gs));
    }
  });

  it('the engine source imports no JSON', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'HorseOmahaMadeHandCallFloor.ts'),
      'utf8'
    );
    expect(/from\s+'[^']+\.json'/.test(src)).toBe(false);
  });
});

describe('omahaMadeHandCallFloor: the decision', () => {
  const decide = (st: ReturnType<typeof base>, opts: HorseDecideOpts, seed: number) => {
    HorseMind.reset();
    seedFastRandom(seed);
    return HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...opts,
    } as never);
  };

  it('on: a recorded spot holding an IN-cell hand is never folded', () => {
    for (const { st } of inCellSpots())
      for (const seed of [1, 2]) {
        const d = decide(structuredClone(st), { omahaMadeHandCallFloor: true }, seed);
        expect(d.action).not.toBe('fold');
      }
  });

  it('on vs off: decisions differ only where off folded in an IN cell', () => {
    for (const r of RECORDED_FACING_BETS)
      for (const seed of [1, 2]) {
        const off = decide(base(r), {}, seed);
        const on = decide(base(r), { omahaMadeHandCallFloor: true }, seed);
        const st = base(r);
        if (off.action === 'fold' && omahaMadeHandCallSpot(st.hero, st.gs)) {
          expect(['call', 'all_in']).toContain(on.action);
        } else {
          expect({ action: on.action, amount: on.amount ?? null }).toEqual({
            action: off.action,
            amount: off.amount ?? null,
          });
        }
      }
  });

  it('is an answer of the wager_rules node after the last owner rule', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'HorseLogic.ts'),
      'utf8'
    );
    const floor = src.indexOf('omahaMadeHandCallFloorRule(\n        openMeasured');
    expect(floor).toBeGreaterThan(src.indexOf('const openMeasured = omahaOpenMeasuredRule('));
    expect(src.indexOf('return { decision: madeHandFloored };')).toBeGreaterThan(floor);
    expect(src.indexOf("decision = graph.run('wager_rules'")).toBeGreaterThan(floor);
  });
});
