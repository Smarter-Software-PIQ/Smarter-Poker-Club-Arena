/**
 * Hold'em and Omaha fixed-input full-hand replay against main — explicit false
 * persona options (`holdemPersonaReRaiseMix: false`, `holdemPersonaPreflop: false`).
 * Split from HoldemPersonaReplayVsMain.test.ts for balanced Vitest sharding.
 */
import { describe, expect, it } from 'vitest';
import {
  HOLDEM_REPLAY_TIMEOUT_MS,
  loadRecordedReplay,
  verifyReplayOptionOff,
} from './HoldemPersonaReplayVsMain.test-support.js';

describe("Hold'em and Omaha full-hand replay against main (options explicitly false)", () => {
  if (process.env.HOLDEM_REPLAY_RECORD) return;
  const recorded = loadRecordedReplay();

  for (const [label, extra] of [
    ['false', { holdemPersonaReRaiseMix: false }],
    ['holdemPersonaPreflop false', { holdemPersonaPreflop: false }],
  ] as const) {
    it(
      `option ${label}: every hand of every hold'em and Omaha cell equals main`,
      () => {
        const { hands } = verifyReplayOptionOff(
          recorded,
          label,
          extra,
          (actual, expected, name) => {
            expect(actual, name).toBe(expected);
          }
        );
        expect(hands).toBe(5800);
      },
      HOLDEM_REPLAY_TIMEOUT_MS
    );
  }
});
