import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner ruling, 2026-11-17: "a tournament issue must always be isolated and
 * never affect other tournaments or cash games". Incident 075013fd, lane T.
 *
 * Every tournament table writer took the platform key G shared before its own
 * T(id), and the hand commit took G shared for cash tables too. Postgres
 * queues a new shared request behind a WAITING exclusive one, so a global
 * authority still queued for G (behind any other event's slow authority)
 * paused every table on the platform: 6 to 14 s at a time on production on
 * 2026-11-17. Migration 20261118160405 moves the writers onto the hand
 * barrier B, which a global authority requests only once it HOLDS G. The
 * behaviour is executed on real PostgreSQL by the native harness pinned
 * below (exact production pre-images, before and after, 480-transaction
 * deadlock workload); this file pins the migration's shape so neither the
 * writers nor the harness can drift back unnoticed.
 */
const file = '20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(readFileSync('scripts/ci/fixtures/tournament-lane-isolation/preimages.json', 'utf8'));
const harness = readFileSync('scripts/ci/test-tournament-lane-isolation.py', 'utf8');
const workflow = readFileSync('.github/workflows/table-writer-lane-isolation.yml', 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const G_ACQUIRE = /hashtextextended\(\s*'ca:tournament-terminal-settlement:v1'\s*,/;
const B_ACQUIRE = /hashtextextended\(\s*'ca:hand-settlement-barrier:v1'\s*,/;

const POST: Record<string, string> = {
  'smarter_private.f06_wait_table_lane(uuid)': '32c0483040ec95ffc3c68196c3041749',
  'public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)': '6cea02b2f02dc4e238e7ae17ad0bf9c8',
  'public.fn_ca_share_settlement_lane_for_table(uuid)': 'ff501f74982567097241b1d90fbb4b96',
  'smarter_private.f06_aborted_hand_guard()': '4cab83a49494bd9f0657825384daea71',
  'smarter_private.f06_cancelled_preparation_writer_guard()': '8bb02c9d92510bcd42fd48d2c134c284',
  'smarter_private.f06_source_guard()': '1355f6d7edff0f4939d7c46f86c98699',
  'public.fn_ca_settlement_lane_doctrine()': 'a386f2d5adfbdc1a5ab2ee4a5bee298d',
};
const WRITERS = Object.keys(POST).filter((s) => !s.includes('doctrine'));
const AUTHORITIES: Record<string, string> = {
  'public.fn_ca_lock_settlement_lane_global()': '7c759bb7a639c3124de2607bdbf12577',
  'public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)': '9877846ffabee004690e6b24a3ddcee2',
  'public.fn_ca_lock_settlement_lane_for_finish(uuid)': '1626c6807e525783fa0fae2f1d03d978',
};

function substitutions() {
  const re =
    /\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*(\d+),\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\)/g;
  return [...migration.matchAll(re)].map((m) => ({
    signature: m[1],
    pre: m[2],
    count: Number(m[3]),
    oldText: m[4],
    newText: m[5],
  }));
}
const fixture = (sig: string) => fixtures.functions.find((f) => f.signature === sig)!;

describe('A table writer never waits on the platform lane', () => {
  it('is one bounded transaction with a live proof and one reasoned stale pin', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(/\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/);
    expect(migration).toContain(
      "-- @live-proof: (SELECT md5(pg_get_functiondef('smarter_private.f06_wait_table_lane(uuid)'::regprocedure)) = '32c0483040ec95ffc3c68196c3041749')"
    );
    const stale = [...migration.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map((m) => m[1]);
    expect(stale).toEqual(['409b14ee72ce888d3b26524c52d49a68']);
    // Plain function replacement: never a window file, never a table lock.
    expect(migration).not.toMatch(/@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX/);
  });

  it('works only from the exact production pre-images, and each substitution lands on its pinned post-image', () => {
    const subs = substitutions();
    expect(subs.map((s) => s.signature).sort()).toEqual(Object.keys(POST).sort());
    for (const s of subs) {
      const f = fixture(s.signature);
      expect(md5(f.definition)).toBe(f.md5);
      expect(s.pre).toBe(f.md5);
      expect(f.definition.split(s.oldText)).toHaveLength(s.count + 1);
      const post = f.definition.split(s.oldText).join(s.newText);
      expect(md5(post)).toBe(POST[s.signature]);
      expect(migration).toContain(`('${s.signature}', '${POST[s.signature]}')`);
    }
  });

  it('leaves no table writer naming G, and every one of them takes or tries B', () => {
    const subs = substitutions();
    for (const sig of WRITERS) {
      const s = subs.find((x) => x.signature === sig)!;
      expect(fixture(sig).definition).toMatch(G_ACQUIRE);
      expect(s.oldText).toMatch(G_ACQUIRE);
      const post = fixture(sig).definition.split(s.oldText).join(s.newText);
      expect(post).not.toMatch(G_ACQUIRE);
      expect(post).toMatch(B_ACQUIRE);
    }
    // The 4 s bound and its sentinel stay on the waiting writer.
    const wait = subs.find((x) => x.signature === 'smarter_private.f06_wait_table_lane(uuid)')!;
    const waitPost = fixture(wait.signature).definition.split(wait.oldText).join(wait.newText);
    expect(waitPost).toContain("SET lock_timeout TO '4s'");
    expect(waitPost).toMatch(/EXCEPTION WHEN lock_not_available THEN\s+RAISE EXCEPTION 'F06_RETRY_CANONICAL_LANE' USING ERRCODE = '55P03';/);
    expect(waitPost).not.toMatch(/pg_try_advisory|pg_advisory_xact_lock\(/);
  });

  it('does not touch an authority lane, and refuses to commit if one moved', () => {
    for (const [sig, hash] of Object.entries(AUTHORITIES)) {
      expect(md5(fixture(sig).definition)).toBe(hash);
      expect(migration).toContain(`'${hash}'`);
      const name = sig.replace(/^public\./, '').replace(/\(.*$/, '');
      expect(migration).not.toMatch(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`));
    }
    // fn_ca_lock_settlement_lane_global still takes G then B exclusively, so a
    // global authority that HOLDS the lane still fences every writer through B.
    const global = fixture('public.fn_ca_lock_settlement_lane_global()').definition;
    expect(global.indexOf("'ca:tournament-terminal-settlement:v1', 0")).toBeLessThan(
      global.indexOf("'ca:hand-settlement-barrier:v1', 0")
    );
  });

  it('adds doctrine rule 5 and refuses to commit unless the whole doctrine answers ok', () => {
    const d = substitutions().find((s) => s.signature === 'public.fn_ca_settlement_lane_doctrine()')!;
    expect(d.newText).toContain("'table_writers_never_take_g'");
    for (const sig of WRITERS) expect(d.newText).toContain(`'${sig}'`);
    expect(d.newText).toContain('WHERE p.oid IS NULL');
    expect(migration).toMatch(
      /v_doctrine := public\.fn_ca_settlement_lane_doctrine\(\);\s+IF COALESCE\(\(v_doctrine ->> 'ok'\)::boolean, false\) IS NOT TRUE THEN/
    );
  });

  it('pins its exact bytes to the native PostgreSQL proof that CI runs', () => {
    const hash = createHash('sha256').update(migration).digest('hex');
    expect(harness).toContain(`require_hash = '${hash}'`);
    expect(workflow).toContain(
      'run: python3 scripts/ci/test-tournament-lane-isolation.py --output artifacts/table-writer-lane-isolation'
    );
    expect(workflow).toContain(`- supabase/migrations/${file}`);
    expect(workflow).toContain('- scripts/ci/fixtures/tournament-lane-isolation/**');
    expect(workflow).not.toMatch(/schedule:|cron:/);
    for (const witness of [
      'before: B hole-card writer is refused after 4 s while a global authority only QUEUES for G',
      'before: a CASH hand commit is paused by the queued global authority',
      'after: {k} completes at once while a global authority queues for G',
      "A's settlement holds its lane 10 s: B's hole-card writer completes at once",
      "A's settlement holds its lane 10 s: a cash hand commit completes at once",
      "A's own table waits for A's settlement (bounded 4 s, F06_RETRY sentinel)",
      'a direct guarded write is refused while a global authority HOLDS the lane',
      'a writer waits for a global authority that HOLDS the lane, then writes (fence preserved)',
      'a global authority cannot take the lane over an open writer (B fence)',
      'doctrine rule 5 names a writer that takes G again',
      'a drifted pre-image refuses the whole migration and nothing changes',
      'mixed writer/authority/finish/global transactions: zero deadlocks',
    ]) {
      expect(harness).toContain(witness);
    }
  });
});
