/**
 * Test support: FIXED-INPUT FULL-HAND REPLAY of hold'em and Omaha, for the
 * comparison of a branch with main (owner D3 option C, 2026-11-13: "replay vs
 * main for Hold'em and Omaha"). Every hand is dealt from a fixed seed and
 * played preflop to showdown through the real HorseLogic.decide (league
 * playHand, Hybrid cash or tournament dials, memory off), and every decision
 * is reduced to one line: street, seat, action, amount and the shared random
 * stream's state after it. A hand's fingerprint is the SHA-256 of its lines.
 *
 * The fixture beside the replay test was recorded by `replayFingerprints({})`
 * from a `git archive` of main (this file copied in, run under main's own
 * vitest setup); its `recordedFrom` names the commit. Only exports that exist
 * on main are used, so the same file runs on both sides. Not production code
 * and not imported by any.
 *
 * Re-recorded 2026-11-18 when the league began handing the brain production's
 * decision state (LeagueDecisionState.ts): from main 795b37845fb with ONLY the
 * league's own two files (HorseLeague.ts, LeagueDecisionState.ts) taken from
 * that change, so the fixture is main's brain played by the new league and a
 * branch still equals it only if its brain decides as main's does. A later
 * change to the league itself is recorded the same way.
 */
import { createHash } from 'node:crypto';
import { playHand, leaguePairHandClock, type LeagueGameContext } from './HorseLeague.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import { saveFastRandom } from '../engine/HorseEval.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import type { HorseDecideOpts } from '../engine/HorseLogic.js';

export interface ReplayCell {
  name: string;
  variant: string;
  seats: number;
  stackBB: number;
  mode: 'cash' | 'tournament';
  hands: number;
  family: 'holdem' | 'omaha';
}

export const REPLAY_CELLS: readonly ReplayCell[] = [
  {
    name: 'nlh cash 9 seats 100bb',
    variant: 'nlh',
    seats: 9,
    stackBB: 100,
    mode: 'cash',
    hands: 1000,
    family: 'holdem',
  },
  {
    name: 'nlh cash 6 seats 100bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 100,
    mode: 'cash',
    hands: 1000,
    family: 'holdem',
  },
  {
    name: 'nlh cash 6 seats 30bb',
    variant: 'nlh',
    seats: 6,
    stackBB: 30,
    mode: 'cash',
    hands: 1000,
    family: 'holdem',
  },
  {
    name: 'nlh tournament 9 seats 40bb',
    variant: 'nlh',
    seats: 9,
    stackBB: 40,
    mode: 'tournament',
    hands: 1000,
    family: 'holdem',
  },
  {
    name: 'plo4 cash 6 seats 100bb',
    variant: 'plo4',
    seats: 6,
    stackBB: 100,
    mode: 'cash',
    hands: 600,
    family: 'omaha',
  },
  {
    name: 'plo5 cash 6 seats 100bb',
    variant: 'plo5',
    seats: 6,
    stackBB: 100,
    mode: 'cash',
    hands: 600,
    family: 'omaha',
  },
  {
    name: 'plo6 cash 6 seats 100bb',
    variant: 'plo6',
    seats: 6,
    stackBB: 100,
    mode: 'cash',
    hands: 600,
    family: 'omaha',
  },
];

const BB = 2;
const SB = 1;

function contextFor(cell: ReplayCell): LeagueGameContext {
  if (cell.mode === 'cash') return { gameMode: 'cash', format: 'cash', ante: 0 };
  return {
    gameMode: 'tournament',
    format: 'mtt',
    ante: BB,
    bigBlindAnte: true,
    tournament: {
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      playersLeft: 180,
      spotsPaid: 30,
      entrants: 300,
      avgStackChips: cell.stackBB * BB,
      medianStackChips: cell.stackBB * BB,
      seatsPerTable: cell.seats,
      nearBubble: false,
      inMoney: false,
      payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
      currentSmallBlind: SB,
      currentBigBlind: BB,
      currentAnte: BB,
      anteType: 'big_blind',
      nextSmallBlind: SB * 2,
      nextBigBlind: BB * 2,
      nextAnte: BB * 2,
      nextBlindInMin: 10,
    } as LeagueGameContext['tournament'],
  };
}

/** A fixed synthetic table id for the hand identity every decision carries. */
const REPLAY_TABLE_ID = '1ea90e00-0000-4000-8000-00000000f1a7';

export const cellSeed = (index: number): number => 20261115 + index * 100_003;

export interface HandReplay {
  fingerprint: string;
  decisions: number;
  /** Telemetry keys fired in the hand (empty unless asked for). */
  fires: string[];
}

/**
 * Play every cell with `extra` merged into every seat's options. Each hand
 * gets a hand identity (table id, hand number) as the live worker supplies.
 */
export function replayFingerprints(
  extra: HorseDecideOpts,
  withFires = false
): Record<string, HandReplay[]> {
  enableBrainTelemetry();
  const out: Record<string, HandReplay[]> = {};
  REPLAY_CELLS.forEach((cell, index) => {
    const seed0 = cellSeed(index);
    const profile = HORSE_HYBRID_PROFILES[cell.mode];
    const ctx = contextFor(cell);
    const hands: HandReplay[] = [];
    for (let h = 0; h < cell.hands; h++) {
      const handSeed = (seed0 + h * 7919) >>> 0;
      const lines: string[] = [];
      const fires = new Set<string>();
      drainFires();
      const opts: HorseDecideOpts = {
        ...extra,
        telemetry: true,
        mindPlanContext: {
          version: 1,
          hand: {
            version: 1,
            tableId: REPLAY_TABLE_ID,
            handNumber: 2_000_000 + index * 10_000 + h,
          },
        },
      } as HorseDecideOpts;
      playHand(
        handSeed,
        h % cell.seats,
        () => opts,
        undefined,
        undefined,
        cell.variant,
        cell.seats,
        cell.stackBB,
        ctx,
        () => ({ ...profile.mods }),
        undefined,
        () => profile.style,
        true,
        {
          onAction: (e) => {
            lines.push(`${e.stage}|${e.seatIdx}|${e.action}|${e.amount}|${saveFastRandom()}`);
            for (const f of drainFires()) fires.add(f.feature);
          },
        },
        leaguePairHandClock(h, seed0)
      );
      hands.push({
        fingerprint: createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 24),
        decisions: lines.length,
        fires: withFires ? [...fires].sort() : [],
      });
    }
    out[cell.name] = hands;
  });
  return out;
}
