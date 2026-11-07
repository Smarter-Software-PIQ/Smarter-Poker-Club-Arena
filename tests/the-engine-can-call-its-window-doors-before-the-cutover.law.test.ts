/**
 * LAW: THE ENGINE CAN CALL ITS WINDOW DOORS BEFORE THE CUTOVER (2026-11-07).
 *
 * #9846 made the in-break gate wait until pg_proc holds every door a queued
 * daily-maintenance window migration creates. pg_proc is the database's
 * answer, not the engine's: the engine reaches every door through PostgREST,
 * and PostgREST answers PGRST202 "Could not find the function ... in the
 * schema cache" until its reload after the DDL. Measured on 2026-11-07, 151
 * reloads in 24 h took 1.4-5.9 s each ("Schema cache queried in"), and a
 * window install sends up to six DDL transactions one after another. A new
 * engine that started between the install and the reload would get PGRST202
 * on a door it needs, and the engine-side retry may not be widened to cover
 * it (CLAUDE.md section 2 rule 6: an executed write is never replayed).
 *
 * What this pins:
 *  1. READY means pg_proc AND PostgREST's schema cache. The cache is read
 *     with a probe that cannot execute a door: the door's own parameter names
 *     plus one it does not have, so no overload matches and PostgREST answers
 *     PGRST202 from a cache lookup; its hint is the witness.
 *  2. The witness is exact: "public.<door>(<the target's parameter names>)".
 *     A hint naming another function, no hint, or the door with its OLD
 *     parameters (a CREATE OR REPLACE that changed the signature) is stale,
 *     and stale is PENDING, never READY.
 *  3. Any answer the probe cannot read - a 2xx above all, any other code, an
 *     unreadable body, missing signatures - is UNKNOWN, a named refusal.
 *  4. The parameter names come from the exact target tree's LAST definition
 *     of each door, derived once before the certificate loop, like the list.
 *  5. A door with no named parameter is read from PostgREST's OpenAPI
 *     description instead, because no hint can name it.
 * The response bodies below are PostgREST 14.5's own, captured read-only
 * against production on 2026-11-07 with the publishable key (which cannot
 * execute any of these doors).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 90_000 });

const root = resolve(__dirname, '..');
const HELPER = resolve(root, 'server/scripts/engine-release-window-doors.py');
const TRANSACTION = readFileSync(
  resolve(root, 'server/scripts/engine-release-transaction.sh'),
  'utf8'
);
const HELPER_SOURCE = readFileSync(HELPER, 'utf8');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

function helper(args: string[], env: Record<string, string> = {}) {
  return spawnSync('python3', ['-B', HELPER, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

const pgrst202 = (name: string, sent: string, hint: string | null) => ({
  status: 404,
  body: {
    code: 'PGRST202',
    details: `Searched for the function public.${name} with parameters ${sent} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
    hint,
    message: `Could not find the function public.${name}(${sent}) in the schema cache`,
  },
});

// Captured 2026-11-07 ~13:00Z: the door is not in production yet.
const ABSENT = pgrst202(
  'fn_cash_session_set_blind_off',
  'p_on, p_table_id, p_user_id, z',
  'Perhaps you meant to call the function public.fn_cash_session_close'
);
// Captured: an installed door, probed with its own names plus "z".
const PRESENT = pgrst202(
  'fn_cash_session_evaluate',
  'p_entries, p_table_id, z',
  'Perhaps you meant to call the function public.fn_cash_session_evaluate(p_entries, p_table_id)'
);

function status(
  catalog: unknown,
  cache: unknown,
  signatures: string | null,
  names = 'fn_cash_session_evaluate'
) {
  const dir = temp('window-door-cache-');
  const env: Record<string, string> = {
    ENGINE_WINDOW_DOORS_CATALOG_FIXTURE: join(dir, 'catalog.json'),
    ENGINE_WINDOW_DOORS_CACHE_FIXTURE: join(dir, 'cache.json'),
    ENGINE_WINDOW_DOORS_INSTALL_FIXTURE: join(dir, 'install.json'),
  };
  writeFileSync(env.ENGINE_WINDOW_DOORS_CATALOG_FIXTURE, JSON.stringify(catalog));
  writeFileSync(env.ENGINE_WINDOW_DOORS_CACHE_FIXTURE, JSON.stringify(cache));
  writeFileSync(
    env.ENGINE_WINDOW_DOORS_INSTALL_FIXTURE,
    JSON.stringify({ status: 'completed', conclusion: 'success', url: 'u' })
  );
  const args = ['status', '--env-file', '/nonexistent', '--names', names];
  if (signatures !== null) args.push('--signatures', signatures);
  return helper(args, env);
}

const EVALUATE = '{"fn_cash_session_evaluate":["p_entries","p_table_id"]}';

describe("READY means pg_proc and PostgREST's schema cache", () => {
  it('is READY only when the cache names this door with exactly the target parameters', () => {
    const res = status(['fn_cash_session_evaluate'], { fn_cash_session_evaluate: PRESENT }, EVALUATE);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^READY - .*pg_proc and PostgREST's schema cache/);
  });

  it('is PENDING while pg_proc holds the door and the cache suggests another function', () => {
    const res = status(
      ['fn_cash_session_set_blind_off'],
      { fn_cash_session_set_blind_off: ABSENT },
      '{"fn_cash_session_set_blind_off":["p_on","p_table_id","p_user_id"]}',
      'fn_cash_session_set_blind_off'
    );
    expect(res.status).toBe(10);
    expect(res.stdout).toContain(
      "PENDING - pg_proc holds fn_cash_session_set_blind_off() but PostgREST's schema cache does not expose them"
    );
    expect(res.stdout).toContain('PGRST202');
  });

  it('is PENDING when the cache still holds the OLD signature of a replaced door', () => {
    const res = status(
      ['fn_cash_session_evaluate'],
      { fn_cash_session_evaluate: PRESENT },
      '{"fn_cash_session_evaluate":["p_entries","p_new","p_table_id"]}'
    );
    expect(res.status).toBe(10);
  });

  it('is PENDING when the cache gives no hint at all', () => {
    const res = status(
      ['fn_cash_session_evaluate'],
      { fn_cash_session_evaluate: pgrst202('fn_cash_session_evaluate', 'p_entries, p_table_id, z', null) },
      EVALUATE
    );
    expect(res.status).toBe(10);
  });

  it.each([
    ['a 2xx: the probe matched and ran something', { status: 200, body: { code: 'x' } }],
    ['another error code', { status: 404, body: { code: 'PGRST205', hint: null } }],
    ['a 5xx', { status: 503, body: { code: 'PGRST002' } }],
    ['an unreadable body', { status: 404, body: null }],
  ])('is UNKNOWN, a named refusal, on %s', (_label, answer) => {
    const res = status(['fn_cash_session_evaluate'], { fn_cash_session_evaluate: answer }, EVALUATE);
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/^UNKNOWN - PostgREST's schema cache gave no readable answer/);
  });

  it('is UNKNOWN when the target parameter names were not supplied or are malformed', () => {
    const none = status(['fn_cash_session_evaluate'], { fn_cash_session_evaluate: PRESENT }, null);
    expect(none.status).toBe(3);
    expect(none.stdout).toContain('cannot be witnessed');
    const bad = status(['fn_cash_session_evaluate'], { fn_cash_session_evaluate: PRESENT }, '{"x":[1]}');
    expect(bad.status).toBe(3);
  });

  it('reads a door with no named parameter from the OpenAPI description', () => {
    const sig = '{"fn_no_args":null}';
    expect(status(['fn_no_args'], { fn_no_args: { openapi: true } }, sig, 'fn_no_args').status).toBe(0);
    expect(status(['fn_no_args'], { fn_no_args: { openapi: false } }, sig, 'fn_no_args').status).toBe(10);
  });

  it('never executes a door: the probe always carries a name the door does not have', () => {
    expect(HELPER_SOURCE).toContain("PROBE_KEYS = ('z', 'zz', 'zzz', 'q0')");
    expect(HELPER_SOURCE).toContain('payload[cache_probe_key(params)] = None');
    expect(HELPER_SOURCE).toMatch(/def cache_probe_key\(params\):\n\s+return next\(k for k in PROBE_KEYS if k not in params\)/);
    // A 2xx is never read as exposed.
    expect(HELPER_SOURCE).toContain("if status_code != 404 or body.get('code') != 'PGRST202':");
  });
});

describe('the parameter names come from the exact target tree', () => {
  function repo(files: Record<string, string>) {
    const dir = temp('window-door-signatures-');
    // A git hook exports GIT_DIR and friends; inheriting them would point these
    // commands at the repository being pushed instead of the scratch target.
    const clean = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
    );
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        env: {
          ...clean,
          GIT_AUTHOR_NAME: 'fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      }).trim();
    mkdirSync(join(dir, 'supabase/migrations'), { recursive: true });
    for (const [name, sql] of Object.entries(files))
      writeFileSync(join(dir, 'supabase/migrations', name), sql);
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '--no-gpg-sign', '-m', 'target');
    return { dir, sha: git('rev-parse', 'HEAD') };
  }

  it('takes the LAST definition, skips OUT parameters and reads defaults and typmods', () => {
    const { dir, sha } = repo({
      '20990101000001_a.sql':
        'CREATE FUNCTION public.fn_door(p_old uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\n',
      '20990101000002_b.sql':
        '-- CREATE FUNCTION public.fn_door(p_comment uuid)\n' +
        'CREATE OR REPLACE FUNCTION public.fn_door(\n  p_table_id uuid,\n  p_amount numeric(12, 2) DEFAULT 0,\n  OUT o_result jsonb,\n  IN p_flag boolean DEFAULT NULL\n) LANGUAGE sql AS $$ SELECT NULL::jsonb $$;\n' +
        'CREATE FUNCTION fn_bare() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n',
    });
    const res = helper(['signatures', '--repo', dir, '--sha', sha, '--names', 'fn_door,fn_bare']);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      fn_door: ['p_amount', 'p_flag', 'p_table_id'],
      fn_bare: null,
    });
  });

  it('is UNKNOWN when a door has no definition in the target tree', () => {
    const { dir, sha } = repo({ '20990101000001_a.sql': 'SELECT 1;\n' });
    const res = helper(['signatures', '--repo', dir, '--sha', sha, '--names', 'fn_door']);
    expect(res.status).toBe(3);
  });

  it("reads this repository's queued hit-and-run doors as production will hold them", () => {
    const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = helper([
      'signatures',
      '--repo',
      root,
      '--sha',
      sha,
      '--names',
      'fn_cash_session_set_blind_off,fn_lightning_blind_off_players,fn_cash_session_evaluate',
    ]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      fn_cash_session_evaluate: ['p_entries', 'p_table_id'],
      fn_cash_session_set_blind_off: ['p_on', 'p_table_id', 'p_user_id'],
      fn_lightning_blind_off_players: ['p_pool_session_ids'],
    });
  });
});

describe('the transaction asks the schema cache before any cutover', () => {
  it('derives the signatures once from the target, before the certificate loop, and refuses if it cannot', () => {
    const derive = TRANSACTION.indexOf(
      'python3 -B "$WINDOW_DOORS" signatures --repo "$REPO_DIR" --sha "$SHA" --names "$WINDOW_DOOR_NAMES"'
    );
    const loop = TRANSACTION.lastIndexOf(
      '\nwhile :; do\n',
      TRANSACTION.indexOf('maintenance_certificate "$ADMISSION_MIN_BREAK_MS"')
    );
    expect(derive).toBeGreaterThan(0);
    expect(derive).toBeLessThan(loop);
    expect(TRANSACTION).toContain(
      'WINDOW MIGRATION DOORS REFUSED: UNKNOWN - the parameter names of $WINDOW_DOOR_NAMES in $SHA could not be read'
    );
  });

  it('passes the signatures to every in-break status read', () => {
    const start = TRANSACTION.indexOf('window_doors_ready() {');
    const body = TRANSACTION.slice(start, TRANSACTION.indexOf('\n}\n', start));
    expect(body).toContain('--signatures "${WINDOW_DOOR_SIGNATURES:-}"');
  });

  it('a stale cache waits only inside the admission budget, then refuses by name', () => {
    // The same path as a door missing from pg_proc: PENDING is rc 10, and
    // refuse_unready_window_doors names the refusal once the certificate fails.
    expect(TRANSACTION).toMatch(/10\)\n\s+\[ "\$\{WINDOW_DOORS_WAITING:-0\}" = 1 \]/);
    expect(TRANSACTION).toContain(
      "were not all in pg_proc and PostgREST's schema cache; nothing was prepared and the current engine keeps running"
    );
  });
});
