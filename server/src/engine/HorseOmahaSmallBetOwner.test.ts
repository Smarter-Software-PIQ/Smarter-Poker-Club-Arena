/**
 * omahaSmallBetIsPriced is the one owner of the size of the bet it placed (independent verifier D1/D2/D11, 2026-11-19; owner
 * 2026-11-17 11:49: no blanket rules, the size of the bet must not make or break the decision).
 *
 * Real production decisions: verbatim journal records of PLO5 cash turn decisions on 2026-11-18, after the option went live
 * (19:18:28Z), every seat a Horse (fixtures/omaha-small-bet-owner-journal.ndjson). Each is replayed through the worker runtime
 * exactly as the engine ran it (the record's own inputs, read frame, random state and switch states).
 *
 * In production the limped-pot minimum bet (a bet under 2 BB into a pot of at least 4 BB becomes max(2 BB, 40% of the pot))
 * replaced the size the small-bet price chose, without a price: in hands 60003529 and 60009050 the lifted size was then
 * checked by the owner-ruled check, so the priced small bet became a check (receipt omaha_small_bet_priced_bet_vetoed); in
 * hand 60004351 the priced bet of 3 into 33 was played as 13. Hand 60006966 is the conflict-sweep S4 spot (paired turn, less
 * than a full house, a measured value leader): the card-impact press was withheld by the label while the small-bet rule ran
 * after it on the same decision.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { HorseJournalRecord } from '../services/horseDecisionJournal/record.js';
import { withFrozenHorseReplayClock } from './horseDecision/replay/exactReplay.js';
import { reconstructHorseReplayInput } from './horseDecision/replay/reconstruct.js';
import { replayThroughWorkerRuntime } from './horseDecision/replay/runtimeReplay.js';

// The replay drains the telemetry fires of the decision it ran; keep a copy of every drain so the receipts can be read.
const drained = vi.hoisted(() => ({ batches: [] as { feature: string; fires: number }[][] }));
vi.mock('./BrainTelemetry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./BrainTelemetry.js')>();
  return {
    ...real,
    drainFires: () => {
      const fires = real.drainFires();
      drained.batches.push(fires);
      return fires;
    },
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'horseDecision/replay/fixtures/omaha-small-bet-owner-journal.ndjson');
const RECORDS = new Map<number, HorseJournalRecord>(
  readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { handNumber?: number; record?: HorseJournalRecord })
    .filter((row) => row.record && typeof row.handNumber === 'number')
    .map((row) => [row.handNumber!, row.record!])
);

type OptionState = 'on' | 'off';
async function replay(hand: number, override: Record<string, OptionState> = {}) {
  const record = RECORDS.get(hand);
  if (!record) throw new Error(`fixture hand ${hand} is missing`);
  const body = JSON.parse(record.body) as {
    replayState?: {
      phase8SafetyDisabledReason?: string | null;
      style?: Record<string, OptionState> | null;
      options?: Record<string, OptionState> | null;
    };
  };
  const st = body.replayState ?? {};
  expect(st.options?.omahaSmallBetIsPriced, `hand ${hand} ran with the option on`).toBe('on');
  const input = reconstructHorseReplayInput(record);
  drained.batches = [];
  const out = await withFrozenHorseReplayClock(input.request.decisionTimeMs, () =>
    replayThroughWorkerRuntime(input, {
      phase8SafetyDisabledReason: st.phase8SafetyDisabledReason,
      styleStates: (st.style ?? null) as never,
      optionStates: (st.options ? { ...st.options, ...override } : null) as never,
    })
  );
  if (!out.result) throw new Error(`replay of hand ${hand} refused: ${JSON.stringify(out.error)}`);
  // the first drain parks what was pending before the replay; the rest are the decision's own
  const fires = new Set(drained.batches.slice(1).flatMap((b) => b.map((f) => f.feature)));
  const d = out.result.decision;
  return { action: d.action, amount: d.amount ?? null, fires };
}

describe('the priced small bet is locked OFF-ONLY at the worker runtime (2026-11-21 lead-4 hold); historical on-journals are refused while off replays stay identical', () => {
  it('hand 60003529: worker runtime refuses omahaSmallBetIsPriced=on (off-only); with off override the owner check stands', async () => {
    await expect(replay(60003529)).rejects.toThrow(/omahaSmallBetIsPriced=on \(off-only: hold\)/);
    const off = await replay(60003529, { omahaSmallBetIsPriced: 'off' });
    expect(off.action).toBe('check');
    expect([...off.fires].filter((f) => f.startsWith('omaha_small_bet'))).toEqual([]);
  });

  it('hand 60009050: worker runtime refuses omahaSmallBetIsPriced=on (off-only)', async () => {
    await expect(replay(60009050)).rejects.toThrow(/omahaSmallBetIsPriced=on \(off-only: hold\)/);
  });

  it('hand 60004351: worker runtime refuses omahaSmallBetIsPriced=on (off-only)', async () => {
    await expect(replay(60004351)).rejects.toThrow(/omahaSmallBetIsPriced=on \(off-only: hold\)/);
  });
});

describe('the paired-board press is locked off when omahaSmallBetIsPriced is OFF-ONLY (real hand, verifier D2/D11)', () => {
  it('hand 60006966: worker runtime refuses omahaSmallBetIsPriced=on (off-only); with off override the label still withholds it', async () => {
    await expect(replay(60006966)).rejects.toThrow(/omahaSmallBetIsPriced=on \(off-only: hold\)/);
    const off = await replay(60006966, { omahaSmallBetIsPriced: 'off' });
    expect(off.fires.has('omaha_card_impact_paired_board_press_withheld')).toBe(true);
    expect(off.fires.has('omaha_card_impact_paired_board_press_to_small_bet')).toBe(false);
    expect(off.action).toBe('check');
  });
});
