/**
 * CONTRACT: PUBLIC TABLE & LIGHTNING SHARE PREVIEW RPCS
 *
 * Mirrors fn_ca_tournament_share_preview (migration 20261115161427) for
 * smarter.poker/g/<tableId> and smarter.poker/l/<clusterId>.
 *
 * Verifies:
 *   1. Single-transaction migration with lock_timeout, STABLE, SECURITY DEFINER,
 *      fixed search_path, explicit REVOKE/GRANT, pre-commit probes, and DO $$
 *      postconditions.
 *   2. Zero writes, zero dynamic SQL, zero player/seat/card/hand/wallet/chat
 *      table reads, and every referenced table/cluster/club/union column exists
 *      in scripts/ci/supabase-columns-manifest.json.
 *   3. Privacy redaction invariants (private, VIP, password, deleted, closed,
 *      disabled, non-public club/union, non-platform diamond club -> {found:false}).
 *   4. Exact JSON response keys expected by World Hub sharedGameLink.js.
 *   5. Registration in all four security audit surfaces and clean verdicts from
 *      check-definer-authorization.mjs and migration-function-probes.mjs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_FILE = '20261122025656_table_and_lightning_share_previews.sql';
const MIGRATION_SQL = readFileSync(resolve(ROOT, 'supabase/migrations', MIGRATION_FILE), 'utf8');

const AUTH_ALLOWLIST = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/ci/definer-authorization.allowlist.json'), 'utf8')
) as { anonPublicSurface: Record<string, string> };

const EXPOSURE_BASELINE = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/ci/definer-exposure-baseline.json'), 'utf8')
) as { reviewedAnonReaders: Record<string, string> };

const ANON_SURFACE = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/security/anon-executable-definers.json'), 'utf8')
) as { allowed: Array<{ fn: string; reason: string; note?: string }> };

const COLUMNS_MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/ci/supabase-columns-manifest.json'), 'utf8')
) as { columns: Record<string, string[]> };

function extractFunction(sql: string, fnName: string): { header: string; body: string } {
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\s*\\([^)]*\\)([\\s\\S]*?)AS\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i'
  );
  const m = re.exec(sql);
  if (!m) throw new Error(`Function public.${fnName} not found in ${MIGRATION_FILE}`);
  return { header: m[0].slice(0, m[0].indexOf('AS $$')), body: m[2] };
}

function stripSqlLineComments(s: string): string {
  return s.replace(/--[^\n]*/g, '');
}

function aliasColumns(body: string, alias: string): string[] {
  const clean = stripSqlLineComments(body);
  const matches = new Set<string>();
  const re = new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    matches.add(m[1]);
  }
  return [...matches].sort();
}

describe('table and lightning share preview RPC contract', () => {
  const tableFn = extractFunction(MIGRATION_SQL, 'fn_ca_table_share_preview');
  const lightningFn = extractFunction(MIGRATION_SQL, 'fn_ca_lightning_share_preview');

  let checkDefiner: {
    unauthorisedWriters: (sql: string, allow?: Set<string>, grantSql?: string) => string[];
    anonReadableDefiners: (sql: string, allow?: Set<string>, grantSql?: string) => string[];
    unscopedRosterDefiners: (sql: string, allow?: Set<string>, grantSql?: string) => string[];
    unrevokedClones: (sql: string, allow?: Set<string>, grantSql?: string) => string[];
  };
  let probeChecker: {
    missingProbes: (sql: string) => Array<{ fn: string; reason: string }>;
  };

  beforeAll(async () => {
    checkDefiner = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/check-definer-authorization.mjs'))
        .href
    );
    probeChecker = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
  });

  it('wraps all DDL in one transaction with lock_timeout and no hot-table locks', () => {
    const code = stripSqlLineComments(MIGRATION_SQL);
    expect(code.match(/^\s*BEGIN;\s*$/gm)).toHaveLength(1);
    expect(code.match(/^\s*COMMIT;\s*$/gm)).toHaveLength(1);
    expect(code).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(code).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(code).not.toMatch(/\bLOCK\s+TABLE\b/i);
  });

  it('defines both RPCs as STABLE, SECURITY DEFINER, SET search_path TO public, anon-granted', () => {
    for (const [name, fn, param] of [
      ['fn_ca_table_share_preview', tableFn, 'p_table_id uuid'],
      ['fn_ca_lightning_share_preview', lightningFn, 'p_cluster_id uuid'],
    ] as const) {
      expect(fn.header).toContain(`public.${name}(${param})`);
      expect(fn.header).toMatch(/\bRETURNS\s+jsonb\b/i);
      expect(fn.header).toMatch(/\bLANGUAGE\s+plpgsql\b/i);
      expect(fn.header).toMatch(/\bSTABLE\b/i);
      expect(fn.header).toMatch(/\bSECURITY\s+DEFINER\b/i);
      expect(fn.header).toMatch(/SET\s+search_path\s+TO\s+'public'/i);

      expect(MIGRATION_SQL).toContain(`REVOKE ALL ON FUNCTION public.${name}(uuid) FROM PUBLIC;`);
      expect(MIGRATION_SQL).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(uuid) TO anon, authenticated, service_role;`
      );
    }
  });

  it('is strictly read-only with zero dynamic SQL and zero player/PII/wallet/chat table reads', () => {
    const forbiddenTables = [
      'table_seats',
      'profiles',
      'auth\\.users',
      'club_members',
      'hand_history',
      'hands',
      'table_chat',
      'chat_messages',
      'wallets',
      'chip_transactions',
      'diamond_transactions',
      'lightning_pool_session',
      'lightning_hand',
      'lightning_hand_player',
      'table_waitlist',
      'cash_game_waitlist',
    ];

    for (const [name, fn] of [
      ['fn_ca_table_share_preview', tableFn],
      ['fn_ca_lightning_share_preview', lightningFn],
    ] as const) {
      const clean = stripSqlLineComments(fn.body);
      expect(clean, `${name} must not write`).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|EXECUTE)\b/i
      );
      for (const tbl of forbiddenTables) {
        expect(clean, `${name} must not read ${tbl}`).not.toMatch(new RegExp(`\\b${tbl}\\b`, 'i'));
      }
    }
  });

  it('references only verified columns from supabase-columns-manifest.json', () => {
    const tablesCols = new Set(COLUMNS_MANIFEST.columns.tables);
    const cashGamesCols = new Set(COLUMNS_MANIFEST.columns.cash_games);
    const clubsCols = new Set(COLUMNS_MANIFEST.columns.clubs);
    const unionsCols = new Set(COLUMNS_MANIFEST.columns.unions);

    for (const col of aliasColumns(tableFn.body, 't')) {
      expect(tablesCols.has(col), `tables.${col} must exist in schema manifest`).toBe(true);
    }
    for (const col of aliasColumns(tableFn.body, 'g')) {
      expect(cashGamesCols.has(col), `cash_games.${col} must exist in schema manifest`).toBe(true);
    }
    for (const col of aliasColumns(tableFn.body, 'c')) {
      expect(clubsCols.has(col), `clubs.${col} must exist in schema manifest`).toBe(true);
    }
    for (const col of aliasColumns(tableFn.body, 'u')) {
      expect(unionsCols.has(col), `unions.${col} must exist in schema manifest`).toBe(true);
    }

    for (const col of aliasColumns(lightningFn.body, 'g')) {
      expect(cashGamesCols.has(col), `cash_games.${col} must exist in schema manifest`).toBe(true);
    }
    for (const col of aliasColumns(lightningFn.body, 'c')) {
      expect(clubsCols.has(col), `clubs.${col} must exist in schema manifest`).toBe(true);
    }
    for (const col of aliasColumns(lightningFn.body, 'u')) {
      expect(unionsCols.has(col), `unions.${col} must exist in schema manifest`).toBe(true);
    }
  });

  it('enforces indistinguishable {found:false} privacy redaction for hidden, private, deleted and non-public rows', () => {
    const tBody = stripSqlLineComments(tableFn.body);
    expect(tBody).toContain("RETURN jsonb_build_object('found', false);");
    expect(tBody).toContain('v_t.is_deleted');
    expect(tBody).toContain('v_t.deleted_at');
    expect(tBody).toContain('v_t.is_private');
    expect(tBody).toContain('v_t.is_vip_only');
    expect(tBody).toContain('v_t.is_template');
    expect(tBody).toContain('v_t.terminal_closed_at');
    expect(tBody).toContain("'password'");
    expect(tBody).toContain('v_club.is_public');
    expect(tBody).toContain('v_club.is_private');
    expect(tBody).toContain('v_club.status');
    expect(tBody).toContain('v_club.lifecycle_status');
    expect(tBody).toContain('v_club.is_platform');
    expect(tBody).toContain("'diamonds'");

    const lBody = stripSqlLineComments(lightningFn.body);
    expect(lBody).toContain("RETURN jsonb_build_object('found', false);");
    expect(lBody).toContain('v_g.enabled');
    expect(lBody).toContain('v_g.closed_at');
    expect(lBody).toContain('v_g.cluster_mode');
    expect(lBody).toContain('v_g.lightning_enabled');
    expect(lBody).toContain("'is_private'");
    expect(lBody).toContain("'is_vip_only'");
    expect(lBody).toContain('v_club.is_public');
    expect(lBody).toContain('v_club.is_private');
    expect(lBody).toContain('v_club.status');
    expect(lBody).toContain('v_club.lifecycle_status');
    expect(lBody).toContain('v_club.is_platform');
    expect(lBody).toContain("'diamonds'");
  });

  it('returns the exact public lobby-card JSON shapes expected by World Hub', () => {
    const expectedTableKeys = [
      'found',
      'kind',
      'id',
      'name',
      'game',
      'stakes',
      'smallBlind',
      'bigBlind',
      'maxPlayers',
      'currentPlayers',
      'minBuyIn',
      'maxBuyIn',
      'status',
      'isAllInOrFold',
      'isBombPot',
      'isStraddle',
      'clusterId',
      'club',
      'asset',
    ];
    for (const key of expectedTableKeys) {
      expect(tableFn.body, `table preview must emit "${key}"`).toContain(`'${key}',`);
    }
    expect(tableFn.body).toContain("'kind', 'table'");

    const expectedLightningKeys = [
      'found',
      'kind',
      'id',
      'name',
      'game',
      'stakes',
      'smallBlind',
      'bigBlind',
      'maxPlayers',
      'minBuyIn',
      'maxBuyIn',
      'status',
      'club',
      'asset',
    ];
    for (const key of expectedLightningKeys) {
      expect(lightningFn.body, `lightning preview must emit "${key}"`).toContain(`'${key}',`);
    }
    expect(lightningFn.body).toContain("'kind', 'lightning'");
  });

  it('includes DO $$ postconditions and passes pre-commit probe verification', () => {
    for (const fn of ['fn_ca_table_share_preview', 'fn_ca_lightning_share_preview']) {
      expect(MIGRATION_SQL).toContain(
        `has_function_privilege('anon', 'public.${fn}(uuid)', 'EXECUTE')`
      );
      expect(MIGRATION_SQL).toContain(`public.${fn}('00000000-0000-0000-0000-000000000000'::uuid)`);
      expect(MIGRATION_SQL).toContain(`'public.${fn}(uuid)'::regprocedure`);
    }
    expect(probeChecker.missingProbes(MIGRATION_SQL)).toEqual([]);
  });

  it('registers both RPCs in all four security audit surfaces and clears definer authorization gates', () => {
    const signatures: Array<[string, string]> = [
      ['fn_ca_table_share_preview', 'fn_ca_table_share_preview(p_table_id uuid)'],
      ['fn_ca_lightning_share_preview', 'fn_ca_lightning_share_preview(p_cluster_id uuid)'],
    ];

    for (const [name, sig] of signatures) {
      // 1. definer-authorization.allowlist.json (anonPublicSurface)
      expect(AUTH_ALLOWLIST.anonPublicSurface[name]).toBeTruthy();
      expect(AUTH_ALLOWLIST.anonPublicSurface[name].length).toBeGreaterThan(100);

      // 2. definer-exposure-baseline.json (reviewedAnonReaders)
      expect(EXPOSURE_BASELINE.reviewedAnonReaders[name]).toBeTruthy();
      expect(EXPOSURE_BASELINE.reviewedAnonReaders[name]).toContain('MUST answer before login');
      expect(EXPOSURE_BASELINE.reviewedAnonReaders[name]).toContain('20261122025656');

      // 3. docs/security/anon-executable-definers.json
      const entry = ANON_SURFACE.allowed.find((e) => e.fn === sig);
      expect(entry, `${sig} must be in docs/security/anon-executable-definers.json`).toBeDefined();
      expect(entry?.reason).toBe('public-read');

      // 4. public.ca_browser_definer_allowlist inside the migration
      expect(MIGRATION_SQL).toContain(`'${name}'`);
      expect(MIGRATION_SQL).toContain('INSERT INTO public.ca_browser_definer_allowlist');
      expect(MIGRATION_SQL).toContain('ON CONFLICT (proname) DO NOTHING');
    }

    const anonAllow = new Set(Object.keys(AUTH_ALLOWLIST.anonPublicSurface));
    expect(checkDefiner.unauthorisedWriters(MIGRATION_SQL, new Set(), MIGRATION_SQL)).toEqual([]);
    expect(checkDefiner.anonReadableDefiners(MIGRATION_SQL, anonAllow, MIGRATION_SQL)).toEqual([]);
    expect(checkDefiner.unscopedRosterDefiners(MIGRATION_SQL, anonAllow, MIGRATION_SQL)).toEqual(
      []
    );
    expect(checkDefiner.unrevokedClones(MIGRATION_SQL, new Set(), MIGRATION_SQL)).toEqual([]);
  });
});
