/**
 * The fast call-down read (2026-11-07) must survive the portable read frame:
 * a second look at the same hand prices exactly the station read the first
 * decision did. HorseDecisionReadFrame gains horse-decision-reads-v10 for the
 * river recency window (OpponentStats.rvOpps / rvCalls), written only when a
 * captured row carries one so every earlier frame keeps its exact bytes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { HorseMind } from './HorseMind.js';
import {
  decodeHorseDecisionReads,
  encodeHorseDecisionReads,
  type HorseDecisionReadFrame,
} from './HorseDecisionReadFrame.js';
import { FCA_HERO, FCA_OPP, playFcaPhase } from './HorseFastCalldownRead.test-support.js';
import type { SeatPlayer } from '../types.js';

const players = [{ user_id: FCA_HERO }, { user_id: FCA_OPP }] as SeatPlayer[];
const reseal = (frame: HorseDecisionReadFrame, body: unknown): HorseDecisionReadFrame => {
  const json = JSON.stringify(body);
  return {
    ...frame,
    json,
    bytes: Buffer.byteLength(json),
    sha256: createHash('sha256').update(json).digest('hex'),
  };
};
afterEach(() => HorseMind.reset());

describe('fast call-down read through the decision read frame', () => {
  it('carries the river recency window in a v10 frame and replays the same read', () => {
    playFcaPhase('fold', 30);
    playFcaPhase('call', 10);
    HorseMind.setDecisionScope('holdem:hu', 'nlh', 'cash');
    const live = HorseMind.fastCalldownRead(FCA_OPP);
    HorseMind.setDecisionScope(null);
    expect(live?.callingDown).toBe(true);

    const view = HorseMind.snapshotDecisionReads(players, null, {
      variant: 'nlh',
      mode: 'cash',
      size: 'hu',
    });
    const frame = encodeHorseDecisionReads(view, players, null);
    expect(frame.version).toBe('horse-decision-reads-v10');
    const restored = decodeHorseDecisionReads(frame, players, null);
    expect(restored.stats.get(FCA_OPP)).toMatchObject({
      rvOpps: view.stats.get(FCA_OPP)!.rvOpps,
      rvCalls: view.stats.get(FCA_OPP)!.rvCalls,
    });
    expect(encodeHorseDecisionReads(restored, players, null)).toEqual(frame);

    HorseMind.reset();
    HorseMind.runInSandbox(restored, () => {
      HorseMind.setDecisionScope('holdem:hu', 'nlh', 'cash');
      expect(HorseMind.fastCalldownRead(FCA_OPP)).toEqual(live);
    });
  });

  it('keeps predecessor bytes for a view without the window', () => {
    playFcaPhase('fold', 30);
    const view = HorseMind.snapshotDecisionReads(players, null, {
      variant: 'nlh',
      mode: 'cash',
      size: 'hu',
    });
    for (const map of [view.stats, view.scoped])
      for (const row of map.values()) {
        delete row.rvOpps;
        delete row.rvCalls;
      }
    const frame = encodeHorseDecisionReads(view, players, null);
    expect(frame.version).not.toBe('horse-decision-reads-v10');
    expect(frame.json).not.toContain('riverRecency');
    expect(
      encodeHorseDecisionReads(decodeHorseDecisionReads(frame, players, null), players, null)
    ).toEqual(frame);
  });

  it.each(['missing', 'calls_over_opps', 'negative', 'empty', 'v9_with_window'])(
    'refuses a resealed malformed v10 body: %s',
    (fault) => {
      playFcaPhase('call', 4);
      const frame = encodeHorseDecisionReads(
        HorseMind.snapshotDecisionReads(players, null, {
          variant: 'nlh',
          mode: 'cash',
          size: 'hu',
        }),
        players,
        null
      );
      expect(frame.version).toBe('horse-decision-reads-v10');
      const body = JSON.parse(frame.json);
      if (fault === 'missing') delete body.riverRecency;
      if (fault === 'calls_over_opps') body.riverRecency[0][1][1] = body.riverRecency[0][1][0] + 1;
      if (fault === 'negative') body.riverRecency[0][1][0] = -1;
      if (fault === 'empty') {
        body.riverRecency = [];
        body.scopedRiverRecency = [];
      }
      let bad = reseal(frame, body);
      if (fault === 'v9_with_window') {
        body.version = 'horse-decision-reads-v9';
        bad = { ...reseal(frame, body), version: 'horse-decision-reads-v9' };
      }
      expect(() => decodeHorseDecisionReads(bad, players, null)).toThrow('invalid');
    }
  );
});
