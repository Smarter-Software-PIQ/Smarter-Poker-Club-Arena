/**
 * A SPIN WAITS OUT ITS HORSE LADDER (2026-11-10).
 *
 * fn_spin_expire_unfilled cancels an unfilled Spin once a seated player has
 * waited past spin_fill_policy.unfilled_timeout_minutes. At 30 minutes it
 * cancelled every horse-opened Spin before its first 60-80 minute rung, so no
 * Spin could start (40 cancelled and refunded on 2026-11-10, 12:01-14:41Z).
 * The floor in the database constraint must cover the longest designed wait
 * of SPIN_LADDER plus one 10-minute sweep, and the value set must sit on or
 * above that floor. Change the ladder or the floor alone and this fails.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const LADDER = readFileSync(resolve(ROOT, 'server/src/config/seatFirstLadder.ts'), 'utf8');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith('_a_spin_waits_out_its_horse_ladder.sql'));
const SQL = FILE ? readFileSync(resolve(MIGRATIONS, FILE), 'utf8') : '';

function spinLadderMaxMinutes(): number {
  const start = LADDER.indexOf('export const SPIN_LADDER');
  const body = LADDER.slice(start, LADDER.indexOf('];', start));
  const maxima = [...body.matchAll(/maxMs:\s*(\d+)\s*\*\s*MIN/g)].map((m) => Number(m[1]));
  expect(maxima.length, 'SPIN_LADDER rungs could not be read').toBeGreaterThan(0);
  return maxima.reduce((a, b) => a + b, 0);
}

describe('a Spin waits out its horse ladder', () => {
  const floor = Number(/unfilled_timeout_minutes >= (\d+)\)/.exec(SQL)?.[1]);
  const value = Number(/SET unfilled_timeout_minutes = (\d+)/.exec(SQL)?.[1]);

  it('ships as a migration', () => {
    expect(FILE).toBeTruthy();
  });

  it('the constraint floor covers the longest ladder wait plus one sweep', () => {
    expect(floor).toBeGreaterThanOrEqual(spinLadderMaxMinutes() + 10);
  });

  it('the timeout set sits on or above that floor, and 0 still disables', () => {
    expect(value).toBeGreaterThanOrEqual(floor);
    expect(SQL).toContain('CHECK (unfilled_timeout_minutes = 0 OR unfilled_timeout_minutes >= ');
  });

  it('has no is_horse branch: the rule is the same for everyone', () => {
    expect(SQL.replace(/^--.*$/gm, '')).not.toMatch(/is_horse/);
  });
});
