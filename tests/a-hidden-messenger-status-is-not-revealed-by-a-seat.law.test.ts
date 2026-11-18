/**
 * A HIDDEN MESSENGER STATUS IS NOT REVEALED BY A SEAT (Dan, 2026-11-11).
 *
 * fn_profile_presence is the social presence answer (Messenger, friends,
 * hover cards). A live seat may count as online for a horse, and for a person
 * only while their own presence flag is not false: Messenger Active Status
 * off (and sign-out) writes profiles.is_online = false, and sitting at a
 * table must not override that choice. Behaviour was proved against
 * PostgreSQL 17 when 20261112004925 was written; this law keeps the newest
 * definition from dropping the gate.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const latest = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) =>
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_profile_presence\s*\(/i.test(
      readFileSync(join(dir, f), 'utf8')
    )
  )
  .pop();

export const seatClauseIsGated = (sql: string): boolean => {
  const body = sql.slice(
    sql.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_profile_presence/i)
  );
  const seatAt = body.search(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.table_seats/i);
  if (seatAt < 0) return true; // no seat rule at all cannot reveal a hidden person
  const before = body.slice(0, seatAt);
  return /is_horse/.test(before) && /is_online\s+IS\s+DISTINCT\s+FROM\s+false/i.test(before);
};

describe('a hidden Messenger status is not revealed by a seat', () => {
  it('the newest fn_profile_presence gates the seat rule on horse or a non-false presence flag', () => {
    expect(latest).toBeDefined();
    expect(seatClauseIsGated(readFileSync(join(dir, latest as string), 'utf8')), latest).toBe(true);
  });

  it('refuses the ungated 2026-10-06 seat rule', () => {
    const old = readFileSync(
      join(dir, '20261006040328_a_seated_player_is_online_horse_heartbeat_never_waits.sql'),
      'utf8'
    );
    expect(seatClauseIsGated(old)).toBe(false);
  });
});
