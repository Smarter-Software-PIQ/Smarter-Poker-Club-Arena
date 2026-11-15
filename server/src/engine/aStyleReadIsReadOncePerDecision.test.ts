/**
 * A STYLE READ IS READ ONCE PER DECISION (2026-11-15, Hold'em Strategy lane, opponent classifier C6; no option: a
 * performance change that leaves every decision and every receipt identical).
 *
 * The style read went over its 0.25 ms budget on about 6% of decisions because one decision read the same opponent
 * up to nine times. HorseMind now keeps one result per opponent for the decision in flight (beginStyleReadMemo after
 * the original reads are prepared; the next setDecisionScope closes it; any memory write invalidates it). This file
 * proves the memo is invisible: every fixed context against every synthetic villain, in cash, tournament and on the
 * bubble, with all seven style options on, decides to the same digest (action, amount and RNG position) and fires the
 * same receipts with the memo on as with it off; and the memo is actually used.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  ALL_SPOTS,
  VILLAINS,
  VILLAIN_NAMES,
  VILLAIN,
  decide,
  install,
  type Mode,
} from './HorseOpponentStyle.contexts.test-support.js';

const STYLE_ON = {
  styleRaiseRespect: true,
  styleBigBetHonesty: true,
  styleValueBettorNotManiac: true,
  styleFoldRatePreRepair: true,
  styleValueExtraction: true,
  styleFoldBluff: true,
  styleTightReRaiserRespect: true,
};

afterEach(() => {
  HorseMind.setStyleReadMemo(true);
  HorseMind.reset();
  HorseMind.setDecisionScope(null);
});

const run = (memo: boolean, mode: Mode, opts: Record<string, unknown>) => {
  HorseMind.setStyleReadMemo(memo);
  const out: string[] = [];
  for (const spot of ALL_SPOTS(mode))
    for (const name of VILLAIN_NAMES) {
      install(VILLAINS[name], mode);
      const d = decide(spot, opts);
      const fires = Object.entries(d.fires)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
      out.push(`${spot.name}|${name}|${d.digest}|${fires}`);
    }
  return out;
};

describe('the memo is invisible to decisions and receipts', () => {
  for (const mode of ['cash', 'tournament', 'bubble'] as const)
    for (const [label, opts] of [
      ['style options off', {}],
      ['all seven style options on', STYLE_ON],
    ] as const)
      it(`${mode}, ${label}`, () => {
        const off = run(false, mode, opts);
        HorseMind.takeStyleReadMemoCounts();
        const on = run(true, mode, opts);
        const counts = HorseMind.takeStyleReadMemoCounts();
        expect(on).toEqual(off);
        if (label !== 'style options off') expect(counts.hits).toBeGreaterThan(0);
      });
});

describe('the memo never outlives a write or a decision', () => {
  it('a write between two reads gives a fresh read', () => {
    install(VILLAINS[VILLAIN_NAMES[1]], 'cash');
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.beginStyleReadMemo();
    HorseMind.takeStyleReadMemoCounts();
    const a = HorseMind.styleRead(VILLAIN);
    expect(HorseMind.styleRead(VILLAIN)).toBe(a);
    HorseMind.importStats([{ user_id: VILLAIN, hands: 500 }]);
    HorseMind.styleRead(VILLAIN);
    expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 1, misses: 2 });
  });
  it('a new decision scope closes the memo', () => {
    install(VILLAINS[VILLAIN_NAMES[1]], 'cash');
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.beginStyleReadMemo();
    const a = HorseMind.styleRead(VILLAIN);
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    expect(HorseMind.styleRead(VILLAIN)).not.toBe(a);
    HorseMind.setDecisionReadOptions({});
  });
  it('new read options are a different read', () => {
    install(VILLAINS[VILLAIN_NAMES[1]], 'cash');
    HorseMind.setDecisionScope('holdem:full' as never, 'nlh', 'cash');
    HorseMind.beginStyleReadMemo();
    HorseMind.takeStyleReadMemoCounts();
    HorseMind.styleRead(VILLAIN);
    HorseMind.setDecisionReadOptions({ styleTightMultiSignal: true });
    HorseMind.styleRead(VILLAIN);
    expect(HorseMind.takeStyleReadMemoCounts()).toEqual({ hits: 0, misses: 2 });
  });
});
