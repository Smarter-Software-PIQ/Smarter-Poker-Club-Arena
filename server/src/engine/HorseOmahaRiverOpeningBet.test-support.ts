/**
 * Test support for the heads-up river opening bet laws (omahaRiverValueBetInPositionIsPriced,
 * omahaRiverBluffIsPricedOnBlockers): the real audited fixture and one decide call with a public fold record installed.
 */
import { readFileSync } from 'node:fs';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';

export interface RiverOpeningFixtureNode {
  set: string;
  hand: string;
  audit: { verdict: string; best: string; finding: string | null };
  record: { foldSmall: { folds: number; opps: number }; foldBig: { folds: number; opps: number } };
  player: SeatPlayer;
  gs: HorseGameStateV2;
  style: never;
  mods: never;
  expect: { value: string; bluff: string; off: string };
}
export const RIVER_OPENING_FIXTURE = JSON.parse(
  readFileSync(
    new URL('./HorseOmahaRiverOpeningBet.realHands.fixture.json', import.meta.url),
    'utf8'
  )
) as { opts: Record<string, unknown>; nodes: RiverOpeningFixtureNode[] };

export const card = (s: string): Card =>
  ({
    rank: s[0],
    suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[s[1] as 'c'],
  }) as Card;
export const cards = (s: string): Card[] => (s.match(/../g) ?? []).map(card);

/** One decide call on a fixture node, its opponent's public fold record installed (null: none). */
export function riverOpeningDecide(
  n: RiverOpeningFixtureNode,
  on: Record<string, boolean>,
  withRecord = true
): HorseDecision {
  HorseMind.reset();
  HorseMind.setOmahaLifetimeStreetRecordProvider(
    withRecord
      ? ({
          unopenedWagerRecord: () => null,
          stabSizeRecord: () => null,
          firstWagerFoldRecord: (
            _u: string,
            _g: string,
            street: string,
            players: string,
            size: string
          ) =>
            street === 'river' && players === 'hu'
              ? size === 'big'
                ? n.record.foldBig.opps > 0
                  ? n.record.foldBig
                  : null
                : n.record.foldSmall.opps > 0
                  ? n.record.foldSmall
                  : null
              : null,
        } as never)
      : null
  );
  seedFastRandom(1);
  try {
    return HorseLogic.decide(structuredClone(n.player), structuredClone(n.gs), n.style, n.mods, {
      ...RIVER_OPENING_FIXTURE.opts,
      ...on,
      mind: false,
      telemetry: false,
    } as never) as HorseDecision;
  } finally {
    HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  }
}
