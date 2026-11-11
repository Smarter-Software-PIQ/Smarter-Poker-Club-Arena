/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A SPIN ALERT READS THE LADDER IT WATCHES (2026-11-10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Incident 78afb154-54ae-4661-bf7d-e5e3c18a6eb3. `SpinFleetProducingNothing`
 * paged critical on `poker_spin_seconds_since_last_start > 1800` - half an
 * hour of nothing starting - while the fleet was doing exactly what Dan
 * specified. All 14 waiting seats on all 11 open boards were horses.
 *
 * The 1800 was correct on 2026-09-02, when a Spin filled itself inside six
 * minutes and the room produced about a hundred an hour. The seat-first
 * ladder retired that fleet on 2026-11-08: one horse opens a board, a second
 * may sit after 60-80 minutes and a third after 30-60 more, eleven boards at
 * a time, every rung randomised. Gaps past half an hour became routine, and
 * the number that decided whether to wake somebody up sat in a YAML file that
 * no change to the ladder could reach.
 *
 * THE DEFECT WAS THAT THE THRESHOLD COULD GO STALE SILENTLY, so the fix is
 * not a bigger number: the thresholds are gauges emitted from
 * `seatFirstLadder.ts` itself, and the rule compares one gauge against
 * another. This law is what stops a literal coming back - change the ladder
 * and the alert moves with it, in the same commit, with nothing to remember.
 *
 * The ladder values are re-derived HERE from the source text rather than
 * imported, so a test that imports the same constant the producer imports
 * cannot agree with it vacuously.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The collector is only asked what it EMITS; it must never reach a database.
vi.mock('./supabase.js', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: null, error: { message: 'law fixture' } })) },
}));

import {
  SpinMetrics,
  SPIN_LADDER_FULL_ENVELOPE_SECONDS,
  HUMAN_ARRIVAL_MAX_SECONDS,
} from './SpinMetrics.js';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

const LADDER_SRC = read('../config/seatFirstLadder.ts');
const RULES = read('../../../infra/monitoring/spin-rules.yml');
const RUNBOOK = read('../../../docs/runbooks/spin-fleet-stalled.md');

const ENVELOPE_GAUGE = 'poker_spin_ladder_full_envelope_seconds';
const ARRIVAL_GAUGE = 'poker_spin_human_arrival_max_seconds';

/** Every SPIN_LADDER rung at its maximum, read from the ladder's own text. */
function spinLadderMaxSeconds(): number {
  const start = LADDER_SRC.indexOf('export const SPIN_LADDER');
  expect(start, 'SPIN_LADDER is declared').toBeGreaterThan(-1);
  const body = LADDER_SRC.slice(start, LADDER_SRC.indexOf('];', start));
  const maxima = [...body.matchAll(/maxMs:\s*(\d+)\s*\*\s*MIN/g)].map((m) => Number(m[1]));
  expect(maxima.length, 'SPIN_LADDER rungs could not be read').toBeGreaterThan(0);
  return maxima.reduce((a, b) => a + b, 0) * 60;
}

/** The outside edge of the 3-7 minute promise, read from the ladder's text. */
function humanArrivalMaxSeconds(): number {
  const m = /export const HUMAN_ARRIVAL_MAX_MS\s*=\s*(\d+)\s*\*\s*MIN/.exec(LADDER_SRC);
  expect(m, 'HUMAN_ARRIVAL_MAX_MS could not be read').toBeTruthy();
  return Number(m![1]) * 60;
}

/** The body of one alert, from its name to the start of the next rule. */
function ruleBody(name: string): string {
  const start = RULES.indexOf(`- alert: ${name}`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = RULES.indexOf('- alert: ', start + 1);
  return RULES.slice(start, next === -1 ? undefined : next);
}

/** The single-line `expr:` of one alert. */
function expr(name: string): string {
  const line = ruleBody(name)
    .split('\n')
    .find((l) => /^\s*expr:/.test(l));
  expect(line, `${name} has a single-line expr`).toBeTruthy();
  return line!.replace(/^\s*expr:\s*/, '').trim();
}

/** Emitted gauge value, by name, from a collector that has read nothing. */
function emitted(name: string): number | undefined {
  const line = new SpinMetrics().toPrometheus().find((l) => l.startsWith(`${name} `));
  return line === undefined ? undefined : Number(line.split(' ')[1]);
}

describe('the ladder emits its own envelope', () => {
  it('the envelope gauge is every SPIN_LADDER rung at its maximum', () => {
    expect(SPIN_LADDER_FULL_ENVELOPE_SECONDS).toBe(spinLadderMaxSeconds());
    // Today: 80 + 60 minutes.
    expect(SPIN_LADDER_FULL_ENVELOPE_SECONDS).toBe(8400);
  });

  it('the arrival gauge is the outside edge of the 3-7 minute promise', () => {
    expect(HUMAN_ARRIVAL_MAX_SECONDS).toBe(humanArrivalMaxSeconds());
    expect(HUMAN_ARRIVAL_MAX_SECONDS).toBe(420);
  });

  /**
   * A constant, not a measurement - so it is emitted on the very first scrape,
   * before the collector has ever reached the database. A gauge that appeared
   * only after a successful read would leave the rule comparing against an
   * absent series, which is an empty vector and a permanently green alert:
   * the exact failure check-monitoring-drift.mjs check 8 exists for.
   */
  it('both gauges are emitted by a collector that has never read anything', () => {
    expect(emitted(ENVELOPE_GAUGE)).toBe(spinLadderMaxSeconds());
    expect(emitted(ARRIVAL_GAUGE)).toBe(humanArrivalMaxSeconds());
    const lines = new SpinMetrics().toPrometheus().join('\n');
    for (const g of [ENVELOPE_GAUGE, ARRIVAL_GAUGE]) {
      expect(lines, `${g} has HELP`).toContain(`# HELP ${g}`);
      expect(lines, `${g} has TYPE`).toContain(`# TYPE ${g} gauge`);
    }
  });

  it('the envelope is derived in the producer, not retyped there', () => {
    const src = read('./SpinMetrics.ts');
    expect(src, 'SpinMetrics imports the ladder').toContain("from '../config/seatFirstLadder.js'");
    expect(src).toMatch(/SPIN_LADDER\.reduce\(/);
    expect(src).toMatch(/HUMAN_ARRIVAL_MAX_MS\s*\/\s*1000/);
    /* The numbers must not appear as literals in the CODE. Comments are
       stripped first and deliberately: the header explains that the rule used
       to read `> 1800`, and a check that cannot tell prose from a threshold
       would forbid recording why this exists. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
    for (const literal of ['8400', '840', '420', '1800']) {
      expect(code, `${literal} is not hardcoded in the producer`).not.toContain(literal);
    }
  });
});

describe('SpinFleetProducingNothing reads the ladder, never a literal', () => {
  const e = expr('SpinFleetProducingNothing');

  it('compares the oldest SEATED board against the emitted envelope', () => {
    expect(e).toContain(`poker_spin_unfilled_oldest_wait_seconds > ${ENVELOPE_GAUGE}`);
  });

  /**
   * Incident f1b14fca (2026-11-11 11:19Z): the last-start clock does not
   * restart when the 03:00 park cancels the night's boards, and
   * poker_spin_open_boards counts EMPTY boards nobody is climbing. Neither may
   * gate the stall arm again.
   */
  it('the stall arm is not the last-start clock gated by REGISTERING boards', () => {
    expect(e).not.toContain(`poker_spin_seconds_since_last_start > ${ENVELOPE_GAUGE}`);
    expect(e).not.toContain('poker_spin_open_boards');
  });

  it('pages when a person has waited well past the arrival promise', () => {
    expect(e).toContain(`poker_spin_human_oldest_wait_seconds > 2 * ${ARRIVAL_GAUGE}`);
    expect(e).toContain(`poker_spin_seconds_since_last_start > ${ARRIVAL_GAUGE}`);
  });

  it('is still a critical page, and still exists at all', () => {
    expect(ruleBody('SpinFleetProducingNothing')).toContain('severity: critical');
  });

  /**
   * THE ONE THAT MATTERS. A second-count written beside one of these metrics
   * is a threshold the ladder cannot move - which is the whole defect.
   *
   * A number is allowed only as a MULTIPLE of a ladder gauge (`2 *
   * poker_spin_human_arrival_max_seconds`), because that still moves when the
   * ladder moves. A bare number does not, and is what this forbids.
   */
  it('carries no literal second-count threshold', () => {
    for (const metric of [
      'poker_spin_seconds_since_last_start',
      'poker_spin_human_oldest_wait_seconds',
      'poker_spin_unfilled_oldest_wait_seconds',
    ]) {
      expect(e, `${metric} is compared against a gauge, not a number`).not.toMatch(
        new RegExp(`${metric}\\s*[<>]=?\\s*\\d+(?!\\s*\\*\\s*poker_)`)
      );
    }
    // ...and the guard proves it can still see one: the retired form fails it.
    expect('poker_spin_seconds_since_last_start > 1800').toMatch(
      /poker_spin_seconds_since_last_start\s*[<>]=?\s*\d+(?!\s*\*\s*poker_)/
    );
  });

  /**
   * A horse-only board holds its seats for the whole ladder by design. If the
   * stall threshold were ever set at or below that, the designed state would
   * page - which is exactly what happened at 1800.
   */
  it('a board waiting out its full ladder cannot page', () => {
    expect(SPIN_LADDER_FULL_ENVELOPE_SECONDS).toBeGreaterThanOrEqual(spinLadderMaxSeconds());
    expect(SPIN_LADDER_FULL_ENVELOPE_SECONDS).toBeGreaterThan(HUMAN_ARRIVAL_MAX_SECONDS);
  });
});

describe('SpinHumanWaitingForOpponents reads the same promise', () => {
  it('trips on the arrival gauge rather than the retired sixty seconds', () => {
    const e = expr('SpinHumanWaitingForOpponents');
    expect(e).toContain(`poker_spin_human_oldest_wait_seconds > ${ARRIVAL_GAUGE}`);
    expect(e).not.toMatch(/poker_spin_human_oldest_wait_seconds\s*[<>]=?\s*\d/);
  });
});

describe('the runbook describes the fleet that exists', () => {
  it('no longer claims the retired pre-ladder cadence', () => {
    // The phrase may appear only as the correction of it.
    const claims = RUNBOOK.split('\n').filter(
      (l) => /hundred Spins an hour/.test(l) && !/^Not "/.test(l)
    );
    expect(claims, 'the stale cadence is only ever corrected, never asserted').toEqual([]);
  });

  it('states the ladder envelope and the designed throughput', () => {
    expect(RUNBOOK).toContain('140 minutes');
    expect(RUNBOOK).toContain(String(SPIN_LADDER_FULL_ENVELOPE_SECONDS));
    expect(RUNBOOK).toMatch(/4\.7-7\.3 starts an hour/);
  });

  it('opens triage on who holds the waiting seats, and has the designed case', () => {
    expect(RUNBOOK).toContain('human_seats');
    expect(RUNBOOK).toContain('horse_seats');
    expect(RUNBOOK).toContain('unresolved_seats');
    expect(RUNBOOK, 'the designed 1-2 of 3 has its own case').toMatch(
      /1-2 of 3 live seats.*human_seats = 0/
    );
  });
});

describe('the seat-identity columns the triage query needs exist at source', () => {
  const MIGRATION = readFileSync(
    join(
      __dirname,
      '../../../supabase/migrations',
      '20261110233909_a_waiting_spin_seat_says_whether_a_person_is_in_it.sql'
    ),
    'utf8'
  );

  it('v_spin_unfilled_waits gains the split the runbook queries', () => {
    for (const col of [
      'human_seats',
      'horse_seats',
      'unresolved_seats',
      'oldest_human_seat_at',
      'longest_human_wait',
    ]) {
      expect(MIGRATION, `${col} is added to the view`).toContain(col);
    }
  });

  /**
   * A seat is a horse when it carries a horse_id OR its profile says so. The
   * predicate this replaced was `coalesce(p.is_horse, false)`, which read an
   * unresolvable seat as a PERSON - and under the ladder one such seat on a
   * board designed to wait 140 minutes would have paged every minute for ever.
   */
  it('a person is identified, never assumed', () => {
    expect(MIGRATION).toContain('s.horse_id is null and p.is_horse = false');
    /* Comments stripped first: the header quotes the predicate it replaced,
       and `^\s*(?!--)` cannot exclude a comment line because \s* backtracks
       onto the space before the dashes. */
    const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
    expect(sql, 'the guessing predicate is gone').not.toContain('coalesce(p.is_horse');
  });

  it('is one transaction and proves itself live', () => {
    expect(MIGRATION.match(/^BEGIN;/gm)?.length).toBe(1);
    expect(MIGRATION.match(/^COMMIT;/gm)?.length).toBe(1);
    expect(MIGRATION).toMatch(/^-- @live-proof: \S.*$/m);
  });
});
