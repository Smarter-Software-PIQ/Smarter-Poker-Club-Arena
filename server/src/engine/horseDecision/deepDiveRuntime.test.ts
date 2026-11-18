import { expect, it } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { horseDeepDiveReceiptIsValid } from '../HorseDeepDiveReceipt.js';
import { workerHarness, decisionRequest } from '../../testing/horseRegression/plan/fixture.js';
import { horseJournalJson } from '../../services/horseDecisionJournal/record.js';
import type { DeepHorseDecisionRequest } from './protocol.js';

it('retains producer-time FAST/DEEP receipts only in the bound private original journal', async () => {
  HorseMind.reset();
  const h = workerHarness({ decide: (...args) => HorseLogic.decide(...args) });
  try {
    const request = decisionRequest();
    const fast = await h.fast(request);
    const original = JSON.parse(horseJournalJson(h.captures.at(-1)!));
    expect(original.deepDive).toMatchObject({
      version: 'horse-deep-dive-v1',
      status: 'observed',
      effectiveEnabled: true,
    });
    expect(
      horseDeepDiveReceiptIsValid(
        original.deepDive,
        original.snapshot,
        original.decision,
        original.readFrame.sha256
      )
    ).toBe(true);
    expect(JSON.stringify(fast)).not.toContain('deepDive');
    const deep: DeepHorseDecisionRequest = {
      ...request,
      type: 'DECIDE_DEEP',
      requestId: 101,
      rngBefore: fast.rngBefore,
      deepEquity: 2,
    };
    h.runtime.receive(deep);
    await h.runtime.drain();
    const response = h.messages.find((m) => m.type === 'DEEP_RESULT');
    expect(response?.type).toBe('DEEP_RESULT');
    const second = JSON.parse(horseJournalJson(h.captures.at(-1)!));
    expect(second.snapshot.type).toBe('DECIDE_DEEP');
    expect(second.deepDive).toMatchObject({
      version: 'horse-deep-dive-v1',
      status: 'observed',
    });
    expect(second.readFrame.sha256).toBe(original.readFrame.sha256);
    expect(second.deepDive.inputSha256).not.toBe(original.deepDive.inputSha256);
    expect(
      horseDeepDiveReceiptIsValid(
        second.deepDive,
        second.snapshot,
        second.decision,
        second.readFrame.sha256
      )
    ).toBe(true);
    expect(
      horseDeepDiveReceiptIsValid(
        original.deepDive,
        second.snapshot,
        second.decision,
        second.readFrame.sha256
      )
    ).toBe(false);
    expect(
      horseDeepDiveReceiptIsValid(
        second.deepDive,
        original.snapshot,
        original.decision,
        original.readFrame.sha256
      )
    ).toBe(false);
    expect(JSON.stringify(response)).not.toContain('deepDive');
    const unchanged = JSON.parse(horseJournalJson(original));
    expect(unchanged).toEqual(original);
  } finally {
    await h.close();
  }
});

it('does not allocate or pass a deep-dive collector when journal capture is disabled', async () => {
  let diagnostic: unknown = 'not-called';
  const h = workerHarness({
    journalEnabled: () => false,
    decide: (...args) => {
      diagnostic = args[7];
      return HorseLogic.decide(...args);
    },
  });
  try {
    await h.fast();
    expect(diagnostic).toBeUndefined();
    expect(h.captures).toHaveLength(0);
  } finally {
    await h.close();
  }
});

it('keeps diagnostic gate failure from changing a real computed action', async () => {
  let gates = 0;
  const h = workerHarness({
    journalEnabled: () => {
      if (++gates === 2) throw Error('diagnostic unavailable');
      return true;
    },
    decide: (...args) => HorseLogic.decide(...args),
  });
  try {
    const fast = await h.fast();
    expect(fast.decision.policyFallback).not.toBe('brain_exception');
    expect(h.captures).toHaveLength(1);
    expect(h.captures[0]!.deepDive).toBeUndefined();
  } finally {
    await h.close();
  }
});
