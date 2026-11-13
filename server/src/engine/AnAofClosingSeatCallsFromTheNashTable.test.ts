/**
 * AN ALL-IN-OR-FOLD CLOSING SEAT CALLS A LONE ALL-IN FROM THE NASH CALLER TABLE.
 *
 * Finding HVH2D-NLH-005 (two-day Human vs Horse study, 2026-11-12). At
 * All-In-Or-Fold hold'em tables a Horse facing a single all-in was answered by
 * a fixed strength bar, because the Nash caller table (the "NASH CALL VS JAM"
 * block in HorseLogic) excluded those tables. Measured on development data,
 * closing seat at 12 big blinds or less against Horse all-ins: 17 of 41 folds
 * gave up a profitable call against the table's range.
 *
 * The table now answers at an All-In-Or-Fold table only when both hold:
 *   1. the effective stack is 12 big blinds or less, and
 *   2. the hero closes the action: every other player still in the hand is
 *      all in, so the call ends the hand and nobody can overcall.
 * Every other All-In-Or-Fold decision stays with the fixed bar, and a table
 * that is not All-In-Or-Fold is not touched at all.
 *
 * The All-In-Or-Fold flag is also set on tournament tables, and every saved
 * request here is from one. The change therefore covers tournament decisions
 * too; the tournament utility arbiter still runs after the reference action.
 *
 * The requests are ten anonymised decision-time bodies from the production
 * journal (see the fixture). The journal recorded fold for all ten. Six are
 * real closing seats: Q9s in the small blind with the big blind sitting out,
 * and five big blinds folded to (KQo, QTs, A5o, A3s, A5s), which carry the
 * generator state the journal recorded. The other four have a player still
 * to act behind. Where a case below edits a saved body, the edit is stated
 * on that case.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HorseLogic,
  NASH_AOF_CLOSING_CALL_MAX_BB,
  everyLiveOpponentIsAllIn,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { restoreFastRandom, seedFastRandom } from './HorseEval.js';
import type { SeatPlayer } from '../types.js';
import FIXTURE from './AnAofClosingSeatCallsFromTheNashTable.fixture.json';

type CaseName = keyof typeof FIXTURE.cases;
type Shape = (gs: HorseGameStateV2, player: SeatPlayer) => void;

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** `seed` null replays from the generator state the journal recorded for the decision. */
function decideOnce(name: CaseName, seed: number | null, shape: Shape = () => {}): string {
  const body = FIXTURE.cases[name];
  const gs = structuredClone(body.gameState) as unknown as HorseGameStateV2;
  const player = structuredClone(body.player) as unknown as SeatPlayer;
  shape(gs, player);
  HorseMind.reset();
  if (seed === null) {
    const recorded = (body as { rngBefore?: number }).rngBefore;
    if (recorded === undefined) throw new Error(`${name} carries no recorded generator state`);
    restoreFastRandom(recorded);
  } else {
    seedFastRandom(seed);
  }
  const decision = HorseLogic.decide(
    player,
    gs,
    body.style as never,
    body.mods as never,
    { decisionTimeMs: body.decisionTimeMs, telemetry: true } as never
  ) as unknown as { action: string; amount?: number };
  return decision.amount === undefined ? decision.action : `${decision.action}:${decision.amount}`;
}

/** The distinct answers over every seed: one entry when the answer is the same on all of them. */
function answers(name: CaseName, shape: Shape = () => {}): string[] {
  return [...new Set(SEEDS.map((seed) => decideOnce(name, seed, shape)))].sort();
}

/** Marks every opponent who still has chips as folded, leaving only the all-in player. */
const foldEveryoneBehind: Shape = (gs, player) => {
  for (const p of gs.players) {
    if (p.seat !== player.seat && !p.is_folded && !p.is_all_in) p.is_folded = true;
  }
};

/** The same request at an ordinary table: the flag is cleared and a call is
 * legal again. (With the flag alone cleared, a hero who covers the all-in
 * has no legal call and the answer would be an artefact of the action list.) */
const notAllInOrFold: Shape = (gs) => {
  gs.allInOrFold = false;
  gs.legalActions = ['fold', 'call', 'all_in'];
};

const heroStack =
  (chips: number): Shape =>
  (gs, player) => {
    player.stack = chips;
    gs.players.find((p) => p.seat === player.seat)!.stack = chips;
  };

const both =
  (...shapes: Shape[]): Shape =>
  (gs, player) => {
    for (const shape of shapes) shape(gs, player);
  };

function closes(name: CaseName): boolean {
  const body = FIXTURE.cases[name];
  return everyLiveOpponentIsAllIn(body.gameState.players, body.player.seat);
}

function effectiveBB(name: CaseName): number {
  const { gameState: gs, player } = FIXTURE.cases[name];
  const jammer = gs.players.find((p) => p.is_all_in)!;
  return Math.min(player.stack + player.bet, jammer.stack + jammer.bet) / gs.bigBlind;
}

/** Big blinds folded to, facing the lone all-in: real closing seats, unedited. */
const BIG_BLINDS = [
  'bigBlindKingQueenOffsuit',
  'bigBlindQueenTenSuited',
  'bigBlindAceFiveOffsuit',
  'bigBlindAceThreeSuited',
  'bigBlindAceFiveSuited',
] as const satisfies readonly CaseName[];

afterEach(() => HorseMind.reset());

describe('the saved requests are what they say', () => {
  it('every one is an All-In-Or-Fold hold-em decision facing exactly one all-in', () => {
    for (const name of Object.keys(FIXTURE.cases) as CaseName[]) {
      const gs = FIXTURE.cases[name].gameState;
      expect(gs.allInOrFold, name).toBe(true);
      expect(gs.gameVariant, name).toBe('nlh');
      expect(gs.players.filter((p) => p.is_all_in).length, name).toBe(1);
      expect(
        gs.actionHistory.filter((a) => a.action !== 'fold').map((a) => a.action),
        name
      ).toEqual(['all_in']);
    }
  });

  it('every one is from a tournament table', () => {
    for (const name of Object.keys(FIXTURE.cases) as CaseName[]) {
      expect(FIXTURE.cases[name].gameState.gameMode, name).toBe('tournament');
    }
  });

  it('the Q9s small blind and the five big blinds close the action; the other four do not', () => {
    expect(closes('queenNineSuited')).toBe(true);
    for (const name of BIG_BLINDS) expect(closes(name), name).toBe(true);
    expect(closes('pocketFours')).toBe(false);
    expect(closes('kingThreeOffsuit')).toBe(false);
    expect(closes('pocketFives')).toBe(false);
    expect(closes('aceSevenSuited')).toBe(false);
  });

  it('the five big blinds are in the big blind, at 4.4 to 12 big blinds', () => {
    for (const name of BIG_BLINDS) {
      const body = FIXTURE.cases[name];
      expect(body.gameState.blindSeats.bigBlind, name).toBe(body.player.seat);
      expect(effectiveBB(name), name).toBeLessThanOrEqual(NASH_AOF_CLOSING_CALL_MAX_BB);
    }
    expect(effectiveBB('bigBlindKingQueenOffsuit')).toBeCloseTo(12);
    expect(effectiveBB('bigBlindQueenTenSuited')).toBeCloseTo(7.3333);
    expect(effectiveBB('bigBlindAceFiveOffsuit')).toBeCloseTo(4.375);
    expect(effectiveBB('bigBlindAceThreeSuited')).toBeCloseTo(11.0833);
    expect(effectiveBB('bigBlindAceFiveSuited')).toBeCloseTo(6);
  });

  it('four of the first five are at 12 big blinds or less and A7s is above', () => {
    expect(NASH_AOF_CLOSING_CALL_MAX_BB).toBe(12);
    expect(effectiveBB('queenNineSuited')).toBeCloseTo(7.375);
    expect(effectiveBB('pocketFours')).toBeCloseTo(3);
    expect(effectiveBB('kingThreeOffsuit')).toBeCloseTo(5.5);
    expect(effectiveBB('pocketFives')).toBeCloseTo(7.5625);
    expect(effectiveBB('aceSevenSuited')).toBeCloseTo(15);
  });

  it('holds no real user, table or tournament id, name or avatar', () => {
    const text = JSON.stringify(FIXTURE);
    const ids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !/^00000000-0000-4000-80\d\d-0000000000\d\d$/.test(id))).toEqual([]);
    for (const body of Object.values(FIXTURE.cases)) {
      for (const p of [...body.gameState.players, body.player]) {
        expect(p.username).toBe('seat');
        expect(p.avatar_url).toBeNull();
      }
    }
  });
});

describe('a closing seat at 12 big blinds or less is answered by the Nash caller table', () => {
  it('Q9s in the small blind, big blind sitting out, 7.4 big blinds: goes all in', () => {
    // The saved request, unedited. Before the change: fold on every seed.
    expect(answers('queenNineSuited')).toEqual(['all_in']);
  });

  it('44 with 3 big blinds goes all in once the two blinds behind have folded', () => {
    // Edited: the small blind and the big blind are marked folded, so the
    // hero closes the action. Before the change: fold on every seed.
    expect(answers('pocketFours', foldEveryoneBehind)).toEqual(['all_in']);
  });

  it('55 in the small blind goes all in once the big blind has folded', () => {
    // Edited: the big blind is marked folded. Before the change: fold.
    expect(answers('pocketFives', foldEveryoneBehind)).toEqual(['all_in']);
  });

  it('a hand the table folds is still folded: K3o with everyone behind folded', () => {
    // Edited: seat 5 and both blinds are marked folded.
    expect(answers('kingThreeOffsuit', foldEveryoneBehind)).toEqual(['fold']);
  });
});

describe('a big blind folded to, 4.4 to 12 big blinds, is answered by the Nash caller table', () => {
  // Five saved requests, unedited. The journal recorded fold for each.
  // Before the change: fold from the journal's state and on every seed.
  it.each(BIG_BLINDS)('%s goes all in from the generator state the journal recorded', (name) => {
    expect(decideOnce(name, null)).toBe('all_in');
  });

  it.each(BIG_BLINDS)('%s goes all in on every seed', (name) => {
    expect(answers(name)).toEqual(['all_in']);
  });
});

describe('with a player still to act behind, the fixed bar still decides', () => {
  it('44 with 3 big blinds and both blinds behind: fold, as recorded', () => {
    expect(answers('pocketFours')).toEqual(['fold']);
  });

  it('55 in the small blind with the big blind behind: fold, as recorded', () => {
    expect(answers('pocketFives')).toEqual(['fold']);
  });

  it('K3o with three players behind: fold, as recorded', () => {
    expect(answers('kingThreeOffsuit')).toEqual(['fold']);
  });

  it('Q9s in the small blind folds when the big blind is back in the hand', () => {
    // Edited: the sitting-out big blind is seated again, so it can overcall.
    const bigBlindIsBack: Shape = (gs) => {
      gs.players.find((p) => p.seat === gs.blindSeats!.bigBlind)!.is_sitting_out = false;
    };
    expect(answers('queenNineSuited', bigBlindIsBack)).toEqual(['fold']);
  });
});

describe('above 12 big blinds the fixed bar still decides', () => {
  it('A7s on the button at 15 big blinds: fold, as recorded', () => {
    expect(answers('aceSevenSuited')).toEqual(['fold']);
  });

  it('A7s at 15 big blinds folds from the closing seat as well', () => {
    // Edited: both blinds are marked folded.
    expect(answers('aceSevenSuited', foldEveryoneBehind)).toEqual(['fold']);
  });

  it('the line is 12: 55 closing the action calls at 12 and folds at 12.25', () => {
    // Edited: the big blind is marked folded and the hero's stack is raised.
    // The all-in is 4,900 at a 400 big blind (12.25 big blinds), and the hero
    // has 200 posted: 4,600 behind is 12 big blinds effective, 4,700 behind is
    // 12.25. The table itself calls at both depths, as the twin table that is
    // not All-In-Or-Fold shows.
    expect(answers('pocketFives', both(foldEveryoneBehind, heroStack(4_600)))).toEqual(['all_in']);
    expect(answers('pocketFives', both(foldEveryoneBehind, heroStack(4_700)))).toEqual(['fold']);
    expect(
      answers('pocketFives', both(foldEveryoneBehind, heroStack(4_700), notAllInOrFold))
    ).toEqual(['all_in']);
  });
});

describe('a table that is not All-In-Or-Fold is not touched', () => {
  // The same ten requests at an ordinary table (flag cleared, call legal).
  // The answers are the ones main gave before this change, on every seed. A
  // hero who covers the all-in calls its amount; a covered hero is all in.
  it.each([
    ['queenNineSuited', 'all_in'],
    ['pocketFours', 'all_in'],
    ['pocketFives', 'all_in'],
    ['kingThreeOffsuit', 'fold'],
    ['aceSevenSuited', 'call:3000'],
    ['bigBlindKingQueenOffsuit', 'call:2750'],
    ['bigBlindQueenTenSuited', 'all_in'],
    ['bigBlindAceFiveOffsuit', 'call:1350'],
    ['bigBlindAceThreeSuited', 'all_in'],
    ['bigBlindAceFiveSuited', 'call:2500'],
  ] as const)('%s answers %s as before', (name, expected) => {
    expect(answers(name, notAllInOrFold)).toEqual([expected]);
  });

  it.each([
    ['bigBlindKingQueenOffsuit', 'call:2750'],
    ['bigBlindQueenTenSuited', 'all_in'],
    ['bigBlindAceFiveOffsuit', 'call:1350'],
    ['bigBlindAceThreeSuited', 'all_in'],
    ['bigBlindAceFiveSuited', 'call:2500'],
  ] as const)('%s answers %s from the journal state as before', (name, expected) => {
    expect(decideOnce(name, null, notAllInOrFold)).toBe(expected);
  });

  it('and the closing-seat edits change nothing there either', () => {
    expect(answers('pocketFours', both(foldEveryoneBehind, notAllInOrFold))).toEqual(['all_in']);
    expect(answers('kingThreeOffsuit', both(foldEveryoneBehind, notAllInOrFold))).toEqual(['fold']);
  });
});
