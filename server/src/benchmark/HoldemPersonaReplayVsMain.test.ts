/**
 * Hold'em and Omaha fixed-input full-hand replay against main — option absent
 * (and optional HOLDEM_REPLAY_RECORD recording mode).
 *
 * Sibling shards cover the remaining independent replay passes across Vitest
 * shards so no single shard carries all 5 × 5,800-hand replays sequentially:
 *  - HoldemPersonaReplayVsMain.test.ts (this file): option absent + recorder
 *  - HoldemPersonaReplayVsMainOptionsFalse.test.ts: explicit false flags
 *  - HoldemPersonaReplayVsMainReRaiseMixOn.test.ts: holdemPersonaReRaiseMix on
 *  - HoldemPersonaReplayVsMainPreflopOn.test.ts: holdemPersonaPreflop on
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOLDEM_REPLAY_TIMEOUT_MS,
  REPLAY_CELLS,
  loadRecordedReplay,
  replayFingerprints,
  verifyReplayOptionOff,
  type RecordedReplay,
} from './HoldemPersonaReplayVsMain.test-support.js';

describe("Hold'em and Omaha full-hand replay against main (option absent)", () => {
  if (process.env.HOLDEM_REPLAY_RECORD) {
    it(
      'records main (run from a main archive, see the test-support header)',
      () => {
        const run = replayFingerprints({});
        const out: RecordedReplay = {
          recordedFrom: process.env.HOLDEM_REPLAY_FROM ?? 'unstated',
          cells: Object.fromEntries(
            Object.entries(run).map(([k, v]) => [k, v.map((h) => h.fingerprint)])
          ),
        };
        writeFileSync(process.env.HOLDEM_REPLAY_RECORD!, JSON.stringify(out));
        expect(Object.keys(out.cells).length).toBe(REPLAY_CELLS.length);
      },
      HOLDEM_REPLAY_TIMEOUT_MS
    );
    return;
  }

  const recorded = loadRecordedReplay();

  it(
    "option absent: every hand of every hold'em and Omaha cell equals main",
    () => {
      const { hands } = verifyReplayOptionOff(recorded, 'absent', {}, (actual, expected, name) => {
        expect(actual, name).toBe(expected);
      });
      expect(hands).toBe(5800);
    },
    HOLDEM_REPLAY_TIMEOUT_MS
  );
});
