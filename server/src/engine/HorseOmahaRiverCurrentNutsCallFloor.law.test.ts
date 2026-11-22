/**
 * LAW (omahaRiverCurrentNutsCallFloor, default OFF; EMERG lane RANGE-MODEL-2 2026-11-20):
 * no Horse decision in PLO4/PLO5 cash, on the river facing a wager, folds the exact current
 * nuts where a full chop with every live opponent still returns the call. The floor changes
 * only a fold, only into the legal call (or the whole-stack all-in), reads public information
 * only and no identity, is admitted by the response validator only where it holds, and is
 * byte-identical off, on the turn, in PLO6 and in tournaments. Recorded spots are named by
 * hand id only (anonymised fixtures, HorseOmahaFacingBetEv.test-support.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, HorseDecision } from '../types.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom, scoreOmahaHi } from './HorseEval.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { RECORDED_FACING_BETS, expand } from './HorseOmahaFacingBetEv.test-support.js';
import {
  omahaRiverCurrentNutsCallFloorAdmitsCall,
  omahaRiverCurrentNutsCallFloorRule,
  omahaRiverCurrentNutsCallSpot,
} from './HorseOmahaRiverCurrentNutsCallFloor.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const key = (c: Card) => `${c.rank}:${c.suit}`;
const RIVER = RECORDED_FACING_BETS.filter((r) => (r.st ?? 'river') === 'river');
const legalCall = (d: HorseDecision) => d;

function base(r: (typeof RECORDED_FACING_BETS)[number]) {
  const { fx, node } = expand(r);
  return stateAt(fx, node);
}
/** Hero's cards replaced by the best two cards the board allows plus fillers: the exact current nuts. */
function withNuts(r: (typeof RECORDED_FACING_BETS)[number]) {
  const st = base(r);
  const board = st.gs.communityCards ?? [];
  const n = st.hero.cards.length;
  const used = new Set(board.map(key));
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (!used.has(`${rank}:${suit}`)) deck.push({ rank, suit } as Card);
  let best: Card[] = [];
  let top = -1;
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      const s = scoreOmahaHi([deck[i], deck[j]], board);
      if (s > top) {
        top = s;
        best = [deck[i], deck[j]];
      }
    }
  const taken = new Set(best.map(key));
  const fill = deck.filter((c) => !taken.has(key(c))).slice(-(n - 2));
  st.hero.cards = [...best, ...fill];
  st.hero.knownDeadCards = [];
  return st;
}

describe('omahaRiverCurrentNutsCallFloor: the floor', () => {
  it('is registered dark and scopable per game', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaRiverCurrentNutsCallFloor');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaRiverCurrentNutsCallFloor');
  });

  it('turns a river fold of the exact current nuts into the call for the exact chips owed', () => {
    expect(RIVER.length).toBeGreaterThan(5);
    let n = 0;
    for (const r of RIVER) {
      const st = withNuts(r);
      expect(hasRiverNuts(st.hero, st.gs)).toBe(true);
      const spot = omahaRiverCurrentNutsCallSpot(st.hero, st.gs);
      if (!spot) continue;
      n++;
      const fold: HorseDecision = { action: 'fold', thinkTime: 1 };
      const out = omahaRiverCurrentNutsCallFloorRule(fold, st.hero, st.gs, true, (d) =>
        legalCall(d)
      );
      expect(out.action).toBe('call');
      expect(out.amount).toBe(spot.paid);
      expect(omahaRiverCurrentNutsCallFloorAdmitsCall(st.hero, st.gs, spot.paid)).toBe(true);
      expect(omahaRiverCurrentNutsCallFloorAdmitsCall(st.hero, st.gs, spot.paid + 1)).toBe(false);
      // off, or any non-fold: the same object
      expect(omahaRiverCurrentNutsCallFloorRule(fold, st.hero, st.gs, false, legalCall)).toBe(fold);
      for (const action of ['call', 'raise', 'all_in', 'check'] as const) {
        const d: HorseDecision = { action, amount: 5, thinkTime: 1 };
        expect(omahaRiverCurrentNutsCallFloorRule(d, st.hero, st.gs, true, legalCall)).toBe(d);
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  it('never acts without the nuts (the recorded hands, which are not the nuts)', () => {
    for (const r of RIVER) {
      const st = base(r);
      if (hasRiverNuts(st.hero, st.gs)) continue;
      expect(omahaRiverCurrentNutsCallSpot(st.hero, st.gs)).toBeNull();
      expect(omahaRiverCurrentNutsCallFloorAdmitsCall(st.hero, st.gs, st.gs.toCall)).toBe(false);
    }
  });

  it('is out of scope on the turn, in PLO6, in tournaments, multi-board and facing no wager', () => {
    const st = withNuts(RIVER[0]);
    expect(omahaRiverCurrentNutsCallSpot(st.hero, st.gs)).not.toBeNull();
    const variants: Array<[string, (g: typeof st.gs) => void]> = [
      ['turn', (g) => ((g as { stage: string }).stage = 'turn')],
      ['plo6', (g) => ((g as { gameVariant: string }).gameVariant = 'plo6')],
      ['plo8', (g) => ((g as { gameVariant: string }).gameVariant = 'plo8')],
      ['tournament', (g) => ((g as { gameMode: string }).gameMode = 'tournament')],
      ['bomb', (g) => ((g as { bombPot: boolean }).bombPot = true)],
      ['two boards', (g) => ((g as { boardCount: number }).boardCount = 2)],
      ['no wager', (g) => ((g as { toCall: number }).toCall = 0)],
    ];
    for (const [, mutate] of variants) {
      const s2 = withNuts(RIVER[0]);
      mutate(s2.gs);
      expect(omahaRiverCurrentNutsCallSpot(s2.hero, s2.gs)).toBeNull();
      const fold: HorseDecision = { action: 'fold', thinkTime: 1 };
      expect(omahaRiverCurrentNutsCallFloorRule(fold, s2.hero, s2.gs, true, legalCall)).toBe(fold);
    }
  });

  it('keeps the fold where a full chop with every live opponent would not return the call', () => {
    const st = withNuts(RIVER[0]);
    const live = st.gs.players.filter(
      (p) => p.seat !== st.hero.seat && !p.is_folded && !p.is_sitting_out
    ).length;
    const paid = Math.min(st.gs.toCall!, st.hero.stack);
    // the pot (wager included) set just below the chop bound: (pot + paid) / (live + 1) < paid
    (st.gs as { pot: number }).pot = paid * (live + 1) - paid - 0.01;
    expect(omahaRiverCurrentNutsCallSpot(st.hero, st.gs)).toBeNull();
  });

  it('a short stack calls all in for its stack', () => {
    const st = withNuts(RIVER[0]);
    st.hero.stack = Math.max(0.5, Math.floor(st.gs.toCall! / 2));
    const spot = omahaRiverCurrentNutsCallSpot(st.hero, st.gs);
    expect(spot).not.toBeNull();
    expect(spot!.allIn).toBe(true);
    expect(spot!.paid).toBe(st.hero.stack);
  });

  it('reads no identity: marking every opponent a person or a Horse changes nothing', () => {
    for (const r of RIVER) {
      const a = withNuts(r);
      const b = withNuts(r);
      for (const p of a.gs.players) (p as { is_horse?: boolean }).is_horse = true;
      for (const p of b.gs.players) (p as { is_horse?: boolean }).is_horse = false;
      expect(omahaRiverCurrentNutsCallSpot(a.hero, a.gs)).toEqual(
        omahaRiverCurrentNutsCallSpot(b.hero, b.gs)
      );
    }
  });
});

describe('omahaRiverCurrentNutsCallFloor: the decision', () => {
  const decide = (st: ReturnType<typeof base>, opts: HorseDecideOpts, seed: number) => {
    HorseMind.reset();
    seedFastRandom(seed);
    return HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...opts,
    } as never);
  };

  it('on: a recorded river spot holding the exact current nuts is never folded', () => {
    for (const r of RIVER)
      for (const seed of [1, 2, 3]) {
        const st = withNuts(r);
        if (!omahaRiverCurrentNutsCallSpot(st.hero, st.gs)) continue;
        const d = decide(st, { omahaRiverCurrentNutsCallFloor: true }, seed);
        expect(d.action).not.toBe('fold');
      }
  });

  it('on vs off: decisions differ only where off folded the exact current nuts', () => {
    for (const r of RIVER)
      for (const seed of [1, 2]) {
        const off = decide(base(r), {}, seed);
        const on = decide(base(r), { omahaRiverCurrentNutsCallFloor: true }, seed);
        expect({ action: on.action, amount: on.amount ?? null }).toEqual({
          action: off.action,
          amount: off.amount ?? null,
        });
      }
  });

  it('is the outermost answer of the wager_rules node (after the last owner rule)', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'HorseLogic.ts'),
      'utf8'
    );
    const floor = src.indexOf('omahaRiverCurrentNutsCallFloorRule(\n        checkedTo2.decision');
    expect(floor).toBeGreaterThan(src.indexOf('const openMeasured = omahaOpenMeasuredRule('));
    expect(floor).toBeGreaterThan(src.indexOf('const firstToAct = omahaRiverFirstToActBetRule('));
    // STAB-DEFENCE 2026-11-20: the node now returns through omahaStrongHandCheckRule (default off), which takes the
    // floor's answer and changes only a bet with nothing to call into a check; it never touches a call or a fold.
    const strongCheck = src.indexOf(
      'const strongCheck = omahaStrongHandCheckRule(\n        nutsFloored,'
    );
    expect(strongCheck).toBeGreaterThan(floor);
    expect(src.indexOf('return { decision: strongCheck.decision };')).toBeGreaterThan(strongCheck);
    const nodeEnd = src.indexOf("decision = graph.run('wager_rules'");
    expect(nodeEnd).toBeGreaterThan(floor);
  });
});
