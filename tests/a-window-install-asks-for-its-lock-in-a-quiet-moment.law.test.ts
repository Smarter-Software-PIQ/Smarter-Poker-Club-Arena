/**
 * LAW: A WINDOW INSTALL ASKS FOR ITS LOCK IN A QUIET MOMENT (2026-11-07).
 *
 * A daily-maintenance window file gets ONE lock request with a 1 s
 * lock_timeout (pinned by a-window-migration-waits-for-the-daily-break), and
 * the freeze stops writers to money and seat rows, not readers. On 2026-11-07
 * the first queued file was refused 55P03 after 1096 ms, and by design every
 * later file - including the hit-and-run migration the next engine needs -
 * stayed queued for a day. Measured read-only that morning: the 04:00 Chicago
 * window opens on minute 0 of a UTC hour, so every every-minute and every-N-
 * minute pg_cron job starts in the same second the installer sends its first
 * file (two of them read public.clubs for up to 3.9 s), sp_prune_hand_history
 * holds hand_history, tables and tournaments 7-11 s of every 10 s, and the
 * stall watch runs back to back through the break.
 *
 * What this pins:
 *  1. Before its one attempt the installer reads pg_locks (read-only: no lock
 *     is requested, nothing queues behind it) for exactly the relations the
 *     file will lock, and waits for no conflicting holder older than
 *     QUIET_HOLDER_AGE_MS. When its bound passes it sends anyway, once.
 *  2. The wait is bounded and its deadline is DERIVED from the break clocks:
 *     the release's admission certificate (engine-release-transaction.sh)
 *     leaves 40 s, minus the measured PostgREST reload and one door poll.
 *  3. Nothing pinned elsewhere moves: one spawnSync per file, the 1 s
 *     lock_timeout, the stop-at-first-refusal rule, no retry.
 *  4. A refusal names who held the tables, so the owning lane can act.
 * Native proof: case 11 of scripts/ci/test-maintenance-window-migrations.sh.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lockTargets,
  quietWaitBudgetMs,
  CONFLICTS,
  QUIET_HOLDERS_QUERY,
  QUIET_HOLDER_AGE_MS,
  QUIET_WAIT_MAX_SECONDS,
  RELEASE_ADMISSION_SECONDS,
  SCHEMA_CACHE_RELOAD_SECONDS,
  RELEASE_DOOR_POLL_SECONDS,
  DOOR_INSTALL_DEADLINE_SECONDS,
  START_RESERVE_SECONDS,
  WINDOW_LOCK_TIMEOUT_MS,
} from '../scripts/ci/maintenance-window-migrations.mjs';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const installer = read('scripts/ci/install-window-migrations.mjs');
const transaction = read('server/scripts/engine-release-transaction.sh');

describe('the file says which tables it will lock, and how hard', () => {
  it("reads the 2026-11-07 queue as production's lock manager will", () => {
    const targets = (f: string) => lockTargets(read(`supabase/migrations/${f}`));
    expect(
      targets('20261106004812_a_built_midway_free_buy_refuses_a_shape_its_schedule_does_no.sql')
    ).toEqual([{ relation: 'public.tournaments', mode: 'ShareRowExclusiveLock' }]);
    expect(targets('20261106091733_horse_public_memory_exact_rule_domains.sql')).toEqual([
      { relation: 'public.hand_atomic_commits', mode: 'ShareRowExclusiveLock' },
      { relation: 'public.hand_history', mode: 'AccessExclusiveLock' },
      { relation: 'public.horse_exact_profiles', mode: 'AccessExclusiveLock' },
    ]);
    expect(targets('20261106203853_hit_and_run_ten_hands_in_profit.sql')).toEqual([
      { relation: 'public.cash_player_session', mode: 'AccessExclusiveLock' },
    ]);
    expect(targets('20261107040516_clubs_choose_their_hand_count_before_leaving.sql')).toEqual([
      { relation: 'public.clubs', mode: 'AccessExclusiveLock' },
    ]);
    expect(targets('20261107020241_club_data_shows_hit_and_run_countdowns.sql')).toEqual([]);
  });

  it('keeps the strongest mode, honours LOCK modes, and ignores comments and function bodies', () => {
    const sql = `BEGIN;
-- ALTER TABLE public.commented_out ADD COLUMN x int;
CREATE INDEX idx ON public.a (x);
CREATE TRIGGER t AFTER INSERT OR UPDATE OF x ON ONLY "public"."a" FOR EACH ROW EXECUTE FUNCTION f();
ALTER TABLE IF EXISTS b ADD CONSTRAINT fk FOREIGN KEY (a_id) REFERENCES smarter_private.c (id);
LOCK TABLE public.d, public.e IN SHARE MODE;
LOCK public.f;
DROP TRIGGER IF EXISTS old ON public.g;
CREATE FUNCTION public.h() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN ALTER TABLE public.in_body ADD COLUMN y int; END $fn$;
COMMIT;`;
    expect(lockTargets(sql)).toEqual([
      { relation: 'public.a', mode: 'ShareRowExclusiveLock' },
      { relation: 'public.b', mode: 'AccessExclusiveLock' },
      { relation: 'public.d', mode: 'ShareLock' },
      { relation: 'public.e', mode: 'ShareLock' },
      { relation: 'public.f', mode: 'AccessExclusiveLock' },
      { relation: 'public.g', mode: 'AccessExclusiveLock' },
      { relation: 'smarter_private.c', mode: 'ShareRowExclusiveLock' },
    ]);
  });

  it("waits on exactly the held modes PostgreSQL's conflict table says", () => {
    expect(CONFLICTS.AccessExclusiveLock).toHaveLength(8);
    expect(CONFLICTS.AccessExclusiveLock).toContain('AccessShareLock');
    expect(CONFLICTS.ShareRowExclusiveLock).not.toContain('AccessShareLock');
    expect(CONFLICTS.ShareRowExclusiveLock).not.toContain('RowShareLock');
    expect(CONFLICTS.ShareRowExclusiveLock).toContain('RowExclusiveLock');
    expect(CONFLICTS.ShareLock).not.toContain('ShareLock');
    expect(CONFLICTS.ShareLock).toContain('RowExclusiveLock');
  });
});

describe('the wait requests no lock and is read-only', () => {
  it('is one SELECT over pg_locks and pg_stat_activity', () => {
    const q = QUIET_HOLDERS_QUERY.replace(/'[^']*'/g, "''");
    expect(q.trim()).toMatch(/^WITH t AS \(/);
    expect(q).not.toMatch(/\b(LOCK|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|pg_advisory|pg_sleep|pg_terminate|pg_cancel)\b/i);
    expect(QUIET_HOLDERS_QUERY).toContain('JOIN pg_locks l ON l.relation = t.oid AND l.granted');
    expect(QUIET_HOLDERS_QUERY).toContain('l.pid IS DISTINCT FROM pg_backend_pid()');
    expect(QUIET_HOLDER_AGE_MS).toBeLessThan(WINDOW_LOCK_TIMEOUT_MS);
  });
});

describe('the deadline is derived from the break clocks', () => {
  const num = (name: string) => {
    const m = new RegExp(`^${name}=(\\d+)$`, 'm').exec(transaction);
    if (!m) throw new Error(`${name} not found in engine-release-transaction.sh`);
    return Number(m[1]);
  };

  it("equals the release's admission budget minus the schema-cache reload and one door poll", () => {
    const breakMs = num('BREAK_WINDOW_MS');
    const minRemainingMs =
      (num('BREAK_CUTOVER_PROOF_SECONDS') +
        num('BREAK_ROLLBACK_RESERVE_SECONDS') +
        num('BREAK_DEADLINE_SLACK_SECONDS')) *
      1000;
    const admissionMinMs = minRemainingMs - num('BREAK_CERTIFICATE_LAG_SECONDS') * 1000;
    expect(transaction).toContain(
      'BREAK_ADMISSION_MIN_BREAK_MS=$((MIN_BREAK_REMAINING_MS - BREAK_CERTIFICATE_LAG_SECONDS * 1000))'
    );
    expect(RELEASE_ADMISSION_SECONDS).toBe((breakMs - admissionMinMs) / 1000);
    expect(DOOR_INSTALL_DEADLINE_SECONDS).toBe(
      RELEASE_ADMISSION_SECONDS - SCHEMA_CACHE_RELOAD_SECONDS - RELEASE_DOOR_POLL_SECONDS
    );
    // One in-break door poll: the 3 s sleep after a PENDING read plus the
    // certificate and status reads.
    expect(transaction).toMatch(
      /if \[ "\$WINDOW_DOORS_RC" -ne 0 \]; then\n\s+LEGACY_ENTRY_DEADLINE_MS=0\n\s+bounded_sleep 3\n/
    );
    expect(RELEASE_DOOR_POLL_SECONDS).toBeGreaterThanOrEqual(3 + 2);
    // Measured 2026-11-07: 151 PostgREST reloads, max 5.9 s.
    expect(SCHEMA_CACHE_RELOAD_SECONDS).toBeGreaterThanOrEqual(6);
    expect(DOOR_INSTALL_DEADLINE_SECONDS).toBeGreaterThan(0);
  });

  it('never waits past the door deadline, its own cap, or the window start reserve', () => {
    // Early in the break the per-file cap binds (28 - 2 = 26 s > 12 s).
    expect(quietWaitBudgetMs(2, 298)).toBe(QUIET_WAIT_MAX_SECONDS * 1000);
    expect(quietWaitBudgetMs(DOOR_INSTALL_DEADLINE_SECONDS - 1, 270)).toBe(1000);
    expect(quietWaitBudgetMs(60, 240)).toBe(QUIET_WAIT_MAX_SECONDS * 1000);
    expect(quietWaitBudgetMs(140, START_RESERVE_SECONDS + 5)).toBe(3000);
    expect(quietWaitBudgetMs(150, START_RESERVE_SECONDS)).toBe(0);
    // No break row: no wait at all.
    expect(quietWaitBudgetMs(NaN, NaN)).toBe(0);
  });
});

describe('the installer waits, then sends each file once, exactly as before', () => {
  const loop = installer.slice(installer.indexOf('for (const f of queued) {\n  const started'));

  it('asks for the quiet moment before the one spawnSync and never retries', () => {
    expect(loop.match(/spawnSync\(/g)).toHaveLength(1);
    const wait = loop.indexOf('await awaitQuietMoment(f, targets);');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(loop.indexOf('spawnSync('));
    expect(installer).not.toMatch(/\bretry\s*\(/i);
    expect(loop).toContain('Not retried.');
  });

  it('sends anyway when the bound passes, and an unreadable pg_locks is not a refusal', () => {
    expect(installer).toContain('sending \\`${f}\\` once as before. ');
    expect(installer).toContain('unreadable before \\`${f}\\` (${e.message}); sending it now, once');
    // The gate never exits the run.
    const gate = installer.slice(
      installer.indexOf('async function awaitQuietMoment'),
      installer.indexOf('async function holdersAfterRefusal')
    );
    expect(gate).not.toMatch(/\bfinish\(/);
    expect(gate).toContain('quietWaitBudgetMs(row.into_break_s, row.remaining_s)');
  });

  it('names who held the tables when a file is refused', () => {
    expect(loop).toMatch(/if \(run\.status === 1 && targets\.length > 0\) \{[\s\S]*holdersAfterRefusal\(targets\)/);
    expect(installer).toContain('after the refusal: ${describeHolders(row.holders)');
  });
});
