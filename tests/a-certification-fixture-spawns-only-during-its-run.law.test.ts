/**
 * A CERTIFICATION FIXTURE SPAWNS ONLY DURING ITS RUN (2026-11-20).
 *
 * Crest Cert 1794950026440-vqxq6 (aa090f23-...) was created by the Club Create
 * certificate on 2026-11-17. Its run's cleanup failed at the retirement door,
 * the club stayed lifecycle_status='active', and its welcome schedule
 * ('Daily 25 Chip Freezeout', 19:00 UTC) spawned an empty board every day
 * until the boards helped page TournamentNeverStarted on 2026-11-20.
 *
 * Two behaviours are pinned here:
 *
 *  1. THE DATABASE GATE. The one write every materialized occurrence starts
 *     with - the spawn claim INSERT into tournament_schedule_spawns - is
 *     refused for a schedule whose club is owned by a reserved certification
 *     identity and is older than the certification stale floor, and refused
 *     with SQLSTATE 23505, the code the engine's claimSpawn already treats as
 *     "stand down quietly". The floor is the same 162 minutes as the residue
 *     sweep's STALE_ACCOUNT_AGE_MS, so a running certificate is never gated.
 *
 *  2. THE RUN'S OWN CLEANUP RUNS ON EVERY EXIT. Each certification script
 *     wraps its cleanup in cleanupOnce and installs retireOnSignal, so a
 *     cancelled or timed-out job (SIGINT/SIGTERM, which skip a plain finally)
 *     still retires its fixture through the guarded doors, exactly once.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  cleanupOnce,
  retireOnSignal,
  SIGNAL_EXIT_CODES,
} from '../scripts/ci/certification-run-cleanup.mjs';
import { STALE_ACCOUNT_AGE_MS } from '../scripts/ci/production-e2e-account.mjs';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIGRATION =
  'supabase/migrations/20261121000812_certification_fixture_schedule_spawns_only_during_its_run.sql';
const SCRIPTS = [
  'scripts/ci/certify-club-create.mjs',
  'scripts/ci/certify-rabbit-hunt.mjs',
  'scripts/ci/certify-heads-up-rematch.mjs',
];

describe('a certification fixture schedule materializes nothing after its run', () => {
  const sql = read(MIGRATION);

  it('gates the spawn claim, the write every occurrence starts with', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_ca_certification_fixture_spawns_only_during_its_run\s+BEFORE INSERT ON public\.tournament_schedule_spawns\s+FOR EACH ROW/
    );
    // The engine claims before it inserts a tournament on both paths.
    const svc = read('server/src/services/ScheduledTournamentService.ts');
    const claim = svc.indexOf('if (!(await this.claimSpawn(schedule.id, spawnKey))) return;');
    expect(claim).toBeGreaterThan(0);
    expect(svc.indexOf(".from('tournaments')\n      .insert(row)", claim)).toBeGreaterThan(claim);
    expect(svc.indexOf('this.spawnDiamondInstance(', claim)).toBeGreaterThan(claim);
  });

  it('refuses with 23505, which the running engine already obeys silently', () => {
    expect(sql).toMatch(/RAISE EXCEPTION\s+'CERT_FIXTURE_PAST_ITS_RUN:/);
    expect(sql).toMatch(/USING ERRCODE = '23505'/);
    const svc = read('server/src/services/ScheduledTournamentService.ts');
    const body = svc.slice(svc.indexOf('private async claimSpawn('));
    // 23505 returns false before any reportError: no report, no page.
    expect(body.indexOf("error.code === '23505'")).toBeGreaterThan(0);
    expect(body.indexOf("error.code === '23505'")).toBeLessThan(body.indexOf('reportError('));
  });

  it('uses the same 162-minute floor as the residue sweep', () => {
    expect(STALE_ACCOUNT_AGE_MS).toBe(162 * 60_000);
    const floors = [...sql.matchAll(/interval '(\d+) minutes'/g)].map((m) => Number(m[1]));
    expect(floors.length).toBeGreaterThan(0);
    // 161 appears only as the inside-the-run self-check.
    expect(new Set(floors.filter((m) => m !== 161))).toEqual(
      new Set([STALE_ACCOUNT_AGE_MS / 60_000])
    );
    expect(sql).toMatch(/c\.created_at <= p_at - interval '162 minutes'/);
  });

  it('keys on the reserved certification identity, never on horse status', () => {
    expect(sql).toMatch(/public\.fn_ca_reserved_certification_identity\(c\.owner_id\)/);
    const code = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(code).not.toMatch(/is_horse/);
  });

  it('is one transaction with a live proof, applied only from main', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toMatch(/^-- @live-proof: EXISTS \(SELECT 1 FROM pg_trigger/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '2s'/);
  });
});

describe('a certification run retires its fixture on every exit', () => {
  it('every certification script runs its cleanup through cleanupOnce and retireOnSignal', () => {
    for (const file of SCRIPTS) {
      const src = read(file);
      expect(src, file).toContain(
        "import { cleanupOnce, retireOnSignal } from './certification-run-cleanup.mjs';"
      );
      expect(src, file).toMatch(/const retireThisRunsFixtures = cleanupOnce\(async \(\) => \{/);
      expect(src, file).toContain('const releaseSignals = retireOnSignal(retireThisRunsFixtures);');
      expect(src, file).toMatch(
        /\} finally \{\s+try \{\s+await retireThisRunsFixtures\(\);\s+\} finally \{\s+releaseSignals\(\);\s+\}\s+\}/
      );
      // The signal handlers are installed BEFORE the run creates anything.
      const firstClub = [
        src.indexOf("rpc(P.owner.token, 'fn_create_club_atomic'"),
        src.indexOf('await createClubThroughTheFreeze(player'),
      ].filter((i) => i >= 0);
      expect(firstClub.length, file).toBeGreaterThan(0);
      expect(src.indexOf('retireOnSignal(retireThisRunsFixtures)'), file).toBeLessThan(
        Math.min(...firstClub)
      );
    }
  });

  it('the cleanup still retires through the guarded doors, never a hand-written delete', () => {
    const create = read('scripts/ci/certify-club-create.mjs');
    expect(create).toContain('retireCertificationClubWithRetry(');
    for (const file of SCRIPTS.slice(1)) expect(read(file)).toContain('settleRabbitHuntClub(');
    for (const file of SCRIPTS) {
      expect(read(file), file).not.toMatch(/\.from\('clubs'\)\s*\.delete\(/);
    }
  });

  it('cleanupOnce shares one execution and one outcome', async () => {
    const body = vi.fn(async () => 'retired');
    const run = cleanupOnce(body);
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe('retired');
    expect(b).toBe('retired');
    await run();
    expect(body).toHaveBeenCalledTimes(1);

    const failing = cleanupOnce(async () => {
      throw new Error('door refused');
    });
    await expect(failing()).rejects.toThrow('door refused');
    await expect(failing()).rejects.toThrow('door refused');
  });

  it('a SIGTERM retires the fixture once, then exits with the signal status', async () => {
    const proc = new EventEmitter();
    const exit = vi.fn();
    const log = vi.fn();
    let finish!: () => void;
    const body = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const run = cleanupOnce(body);
    const release = retireOnSignal(run, { proc: proc as never, exit, log });

    proc.emit('SIGINT');
    proc.emit('SIGTERM'); // the runner's escalation lands while cleanup runs
    await new Promise((r) => setTimeout(r, 0));
    expect(body).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled(); // never exits before the cleanup settles

    // The script's own finally joins the same cleanup instead of a second one.
    const joined = run();
    finish();
    await joined;
    await new Promise((r) => setTimeout(r, 0));
    expect(body).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(SIGNAL_EXIT_CODES.SIGINT);

    release();
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  it('a failed cleanup after a signal still exits non-zero and says so', async () => {
    const proc = new EventEmitter();
    const exit = vi.fn();
    const log = vi.fn();
    retireOnSignal(
      cleanupOnce(async () => {
        throw new Error('CLUB_RETIRED');
      }),
      { proc: proc as never, exit, log }
    );
    proc.emit('SIGTERM');
    await new Promise((r) => setTimeout(r, 0));
    expect(exit).toHaveBeenCalledWith(143);
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/FAILED: CLUB_RETIRED/);
  });
});
