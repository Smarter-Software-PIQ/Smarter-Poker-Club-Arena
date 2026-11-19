/**
 * LAW: NO UNINTENDED DELAY BETWEEN HANDS (Dan 2026-11-18).
 *
 * Dan, verbatim: "i just don't want any 'un intended delays'". Every intended
 * beat keeps its length - the pot push and its riding total, the muck, the
 * Rabbit Hunt rest, the showdown read, the winning-card display, the rebuy
 * pause. Between them there is nothing: the gap from one hand's settlement
 * (hand_history.ended_at) to the next HAND_START (started_at) is
 *
 *     owedBetweenHandsMs(shape) + at most ENGINE_BETWEEN_HANDS_BUDGET_MS
 *
 * This file holds that three ways:
 *   1. the waterfall: owedBetweenHandsMs is exactly the sum of the named beats
 *      for every hand shape, so no beat can grow a hidden term;
 *   2. the measured gap (added with the F06 pre-reserve change, which moves
 *      the tournament round trips under the rest);
 *   3. the path: every await between the end of the hold and the deal is on a
 *      named list with the reason it is not an unintended delay. A new await
 *      there fails here until it is named, proved to run under the rest, or
 *      removed.
 *
 * Production grading of the same rule, hand by hand:
 * scripts/sql/hand-gap-unintended-delay.sql.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: () => {
      throw new Error('Unexpected database write');
    },
    rpc: () => {
      throw new Error('Unexpected database RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/engineAlerts.js', () => ({
  raiseEngineAlert: vi.fn(async () => true),
  resolveEngineAlert: vi.fn(async () => true),
  firingFingerprints: vi.fn(() => []),
}));
import {
  ENGINE_BETWEEN_HANDS_BUDGET_MS,
  HAND_COMPLETION as H,
  owedBetweenHandsMs,
} from '../config/handCompletionSpec.js';

const DEALING = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineDealing.ts', import.meta.url)),
  'utf8'
);

describe('the owed beats are the whole cadence', () => {
  const push = H.BETS_SWEEP_MS + H.POT_PUSH_MS + H.MUCK_MS;
  const rest = H.NEXT_HAND_REST_MS;
  it.each([
    ['fold win', { wentToShowdown: false }, push + rest],
    [
      'heads-up showdown, chips on the river',
      { wentToShowdown: true, showdownHands: 2 },
      H.SHOWDOWN_READ_BASE_MS + H.WINNING_CARDS_EXTRA_MS + push + rest,
    ],
    [
      'heads-up showdown, nothing on the river',
      { wentToShowdown: true, showdownHands: 2, betsSweepOwed: false },
      H.SHOWDOWN_READ_BASE_MS + H.WINNING_CARDS_EXTRA_MS + push - H.BETS_SWEEP_MS + rest,
    ],
    [
      'all-in run out',
      { wentToShowdown: true, showdownHands: 2, allInShowdown: true, betsSweepOwed: false },
      H.SHOWDOWN_READ_BASE_MS + H.ALL_IN_SHOWDOWN_EXTRA_MS + push - H.BETS_SWEEP_MS + rest,
    ],
    [
      'three-way showdown with a side pot',
      { wentToShowdown: true, showdownHands: 3, potAwardGroups: 2 },
      H.SHOWDOWN_READ_BASE_MS +
        H.SHOWDOWN_READ_PER_EXTRA_HAND_MS +
        H.WINNING_CARDS_EXTRA_MS +
        push +
        H.POT_AWARD_STAGGER_MS +
        rest,
    ],
    [
      'cash bust with the full rebuy pause',
      { wentToShowdown: false, rebuyPauseMs: 5000 },
      push + Math.max(rest, 5000),
    ],
  ] as const)('%s', (_shape, opts, expected) => {
    expect(owedBetweenHandsMs(opts as never)).toBe(expected);
  });

  it('the budget is small and fixed', () => {
    expect(ENGINE_BETWEEN_HANDS_BUDGET_MS).toBeLessThanOrEqual(250);
  });
});

describe('every wait between the hold and the deal is named', () => {
  // Comments are prose, not waits: strip them before reading the code.
  const code = (segment: string): string =>
    segment.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const awaitsIn = (segment: string): string[] =>
    [...code(segment).matchAll(/await\s+([A-Za-z_.]+)(?=[(\s])/g)].map((m) => m[1]);

  it('the hold is one sleep: the owed completion display', () => {
    const a = DEALING.indexOf("this.setLoopPhase('post_hand_hold');");
    const b = DEALING.indexOf('this.armNextHandRest(', a);
    expect(a).toBeGreaterThan(-1);
    expect(awaitsIn(DEALING.slice(a, b))).toEqual(['this.awaitHandCompletionDisplay']);
  });

  it('after the rest the loop waits only on a pause owner, then deals', () => {
    const a = DEALING.indexOf('await this.awaitNextHandRest();');
    const b = DEALING.indexOf('await this.dealHand(activePlayers);', a);
    expect(a).toBeGreaterThan(-1);
    expect(awaitsIn(DEALING.slice(a, b))).toEqual([
      'this.awaitNextHandRest', // the rest itself
      'this.persistPresenceForRestart', // only when a maintenance pause owns the table
      'this.awaitPauseGate', // only when an owner paused the next hand
      'this.persistPresenceForRestart', // the same two, on the post-rest pause check
      'this.awaitPauseGate',
    ]);
  });
});

describe('the production grade reads the same numbers', () => {
  const SQL = readFileSync(
    fileURLToPath(new URL('../../../scripts/sql/hand-gap-unintended-delay.sql', import.meta.url)),
    'utf8'
  );
  it.each([
    ['bets_sweep_ms', H.BETS_SWEEP_MS],
    ['pot_push_ms', H.POT_PUSH_MS],
    ['muck_ms', H.MUCK_MS],
    ['showdown_read_base_ms', H.SHOWDOWN_READ_BASE_MS],
    ['showdown_read_per_extra_hand_ms', H.SHOWDOWN_READ_PER_EXTRA_HAND_MS],
    ['showdown_read_max_ms', H.SHOWDOWN_READ_MAX_MS],
    ['winning_cards_extra_ms', H.WINNING_CARDS_EXTRA_MS],
    ['all_in_showdown_extra_ms', H.ALL_IN_SHOWDOWN_EXTRA_MS],
    ['pot_award_stagger_ms', H.POT_AWARD_STAGGER_MS],
    ['next_hand_rest_ms', H.NEXT_HAND_REST_MS],
    ['engine_between_hands_budget_ms', ENGINE_BETWEEN_HANDS_BUDGET_MS],
  ])('%s', (name, value) => {
    expect(SQL).toMatch(new RegExp(`\\b${value} AS ${name}\\b`));
  });
  it('excludes Lightning hands by their pooled hand row, not by table name', () => {
    expect(SQL).toContain('lightning_hand lh WHERE lh.hand_history_id = hh.id');
  });
  it('never writes', () => {
    expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/i);
  });
});

