import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE DRAIN HAS A LIVE CHECK (2026-11-26). The first live read of the variety
 * drain after a seal found its churn in ten minutes, by hand. The same read is
 * scripts/sql/variety-drain-live-check.sql so every seal gets it from any
 * session. It must stay one read-only statement and keep the checks the
 * regression method names (docs/HORSE-DECISIONS-REGRESSION-METHOD.md, R11).
 */
const ROOT = resolve(__dirname, '..', '..');
const sql = readFileSync(resolve(ROOT, 'scripts/sql/variety-drain-live-check.sql'), 'utf8');
const body = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const method = readFileSync(resolve(ROOT, 'docs/HORSE-DECISIONS-REGRESSION-METHOD.md'), 'utf8');

describe('the variety drain live check', () => {
  it('is one read-only statement', () => {
    expect(body).toMatch(/^\s*WITH\s/i);
    expect(body).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL|DO)\b/i
    );
    const code = body.replace(/'[^']*'/g, "''");
    expect(code.trim().replace(/;\s*$/, '')).not.toContain(';');
  });

  it('never reads a dealt card', () => {
    expect(body).not.toMatch(/hole|hand_cards|dealt_cards|chips_in_cards/i);
  });

  it('keeps every check, each with a verdict', () => {
    for (const check of [
      'heartbeats',
      'released_tables',
      'no_person_released',
      'no_rejoin_while_named',
      'named_tables_closed',
      'fresh_releases_in_window',
      'tables_within_cap',
      'horse_error_log',
      'cap_every_cycle',
      'owed_starts_made',
      'owed_waiting_now',
      'drain_why',
    ]) {
      expect(body).toContain(`'${check}'`);
    }
    expect(body).toContain('variety_drain_tables');
    expect(body).toContain('variety_drain_table');
  });

  it('review 2026-11-26: judges every naming, not one first-to-last block, and fails closed with no release', () => {
    /* a Horse re-joining after the LAST naming (the walk refilling an un-named table) is counted */
    expect(body).toMatch(
      /n\.beat_at < s\.joined_at AND n\.beat_at >= s\.joined_at - interval '10 minutes'/
    );
    /* only Horses count as re-joins; a person sitting down is the person rule, not churn */
    expect(body).toMatch(/is_horse, false\) = true/);
    expect(body).toMatch(/is_horse, false\) = false/);
    /* a person who sat down inside the last fleet cycle is not yet the fleet's to see */
    expect(body).toContain("interval '35 seconds'");
    /* no shipped release, or no heartbeat since it, is a FAIL, never a PASS on zero rows */
    expect(body).toContain(
      "CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) > 0 THEN 'PASS' ELSE 'FAIL' END"
    );
    expect(body).toContain(
      "CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) = 0 THEN 'PASS' ELSE 'FAIL' END"
    );
    expect(body).not.toMatch(/first_named AND|BETWEEN n\.first_named/);
  });

  it('2026-11-26: judges the cap at every beat that carries it and measures how long owed games wait', () => {
    expect(body).toContain("h.detail -> 'cash_room' AS room");
    expect(body).toMatch(/WHEN count\(\*\) = 0 THEN 'INFO'/);
    expect(body).toContain("(room ->> 'counted')::int > (room ->> 'cap')::int");
  });

  it("2026-11-27: a wait ends at the game's first dealt hand, never at the game leaving the owed list", () => {
    /* Live on the 1 AM seal f2b854319ea9: one Lightning game left and re-entered
       the owed list 104 times while it was dealing. Ending a wait when a game
       left the list read that as 114 starts with a 2-minute median; the true
       median, ended by dealt hands, was 429 minutes. */
    expect(body).not.toContain('b.rn - row_number() OVER (PARTITION BY g ORDER BY b.rn) AS grp');
    /* the end of a wait is a cash hand of that game (any of its tables) */
    expect(body).toMatch(
      /FROM public\.hand_history hh JOIN public\.tables t ON t\.id = hh\.table_id/
    );
    expect(body).toContain('hh.tournament_id IS NULL');
    expect(body).toContain('t.cluster_id::text AS game');
    expect(body).toContain(
      '(SELECT d.ts FROM deals d WHERE d.game = w.game AND d.k = w.k + 1) AS started_at'
    );
    /* an owed beat just after a hand of that game is a game that is dealing */
    expect(body).toContain("d.ts < o.ts - interval '3 minutes'");
    /* both wait rows read the same waits; a still-waiting game is one on the last beat */
    expect(body).toContain('FROM waits WHERE started_at IS NOT NULL');
    expect(body).toContain(
      'FROM waits WHERE started_at IS NULL AND last_beat = (SELECT max(beat_at) FROM hb)'
    );
  });

  it('2026-11-27: a wait that began before the window says it is a minimum', () => {
    expect(body).toContain(
      "min(w.ts) <= (SELECT min(beat_at) FROM hb) + interval '60 seconds' AS truncated"
    );
    expect(body.match(/already owed at the release: their waits are minimums/g)?.length).toBe(2);
  });

  it('2026-11-27: says why the drain released what it did, over the beats with a start owed', () => {
    expect(body).toContain("h.detail ->> 'variety_drain_why' AS why");
    expect(body).toContain(
      "SELECT coalesce(why, 'not recorded') AS why, count(*) AS n FROM hb WHERE owed > 0 GROUP BY 1"
    );
  });

  it('is the R11 read the regression method names', () => {
    expect(method).toContain('scripts/sql/variety-drain-live-check.sql');
  });
});
