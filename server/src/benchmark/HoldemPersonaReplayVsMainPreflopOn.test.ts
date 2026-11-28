/**
 * Hold'em and Omaha fixed-input full-hand replay against main —
 * `holdemPersonaPreflop: true`.
 * Split from HoldemPersonaReplayVsMain.test.ts for balanced Vitest sharding.
 */
import { describe, expect, it } from 'vitest';
import {
  HOLDEM_REPLAY_CHANGED_OR_SHIFTED,
  HOLDEM_REPLAY_TIMEOUT_MS,
  loadRecordedReplay,
  verifyReplayOptionOn,
} from './HoldemPersonaReplayVsMain.test-support.js';

describe("Hold'em and Omaha full-hand replay against main (holdemPersonaPreflop on)", () => {
  if (process.env.HOLDEM_REPLAY_RECORD) return;
  const recorded = loadRecordedReplay();

  it(
    "holdemPersonaPreflop on: Omaha equals main; a hold'em hand differs only after a persona comparison changed or a persona bar moved",
    () => {
      const { holdemChanged, holdemDiffer } = verifyReplayOptionOn(
        recorded,
        'holdemPersonaPreflop',
        HOLDEM_REPLAY_CHANGED_OR_SHIFTED,
        (fires, context) => {
          expect(fires, context).toEqual([]);
        }
      );
      // Not vacuous: the option does change hold'em hands.
      expect(holdemChanged).toBeGreaterThan(0);
      expect(holdemDiffer).toBeGreaterThan(0);
    },
    HOLDEM_REPLAY_TIMEOUT_MS
  );
});
