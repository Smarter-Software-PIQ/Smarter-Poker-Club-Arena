import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
// @ts-expect-error plain ESM helper
import {
  extractBreakingDdlOps,
  checkMigrationNMinus1Compat,
  buildServingReferenceIndex,
  isNMinus1SafeAnnotated,
} from '../../scripts/ci/check-migration-n-minus-1-compat.mjs';

const ROOT = resolve(__dirname, '../..');

function makeIndex(files: Record<string, string>) {
  return buildServingReferenceIndex(
    Object.entries(files).map(([path, content]) => ({ path, content }))
  );
}

describe('N-1 serving-engine & window-migration backward-compatibility guard', () => {
  const servingIndex = makeIndex({
    'server/src/engine/HandRecorder.ts': `
      export async function saveHand(db: any) {
        await db.from('hand_history').insert({ table_id: 1, pot_total: 100, status: 'done' });
        await db.rpc('fn_record_hand_result', { p_id: 1 });
      }
    `,
    'server/src/engine/TableService.ts': `
      export async function loadTable(db: any) {
        // comment mentioning legacy_removed_table should never trigger a false positive
        return db.from('tables').select('id, max_players, status');
      }
    `,
    'src/services/walletService.ts': `
      export async function fetchWallet(supabase: any) {
        return supabase.rpc('fn_client_wallet_summary', {});
      }
    `,
  });

  it('refuses DROP TABLE when the table is still referenced by server/src or src', () => {
    const sql = 'BEGIN;\nDROP TABLE IF EXISTS public.hand_history;\nCOMMIT;\n';
    const res = checkMigrationNMinus1Compat('20261128010000_drop_hh.sql', sql, servingIndex);
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]).toMatchObject({
      kind: 'DROP_TABLE',
      target: 'public.hand_history',
    });
    expect(res.violations[0].references).toContain('server/src/engine/HandRecorder.ts');
  });

  it('refuses DROP COLUMN, ALTER COLUMN TYPE, RENAME COLUMN, and RENAME TABLE on serving tables', () => {
    const cases: Array<[string, string]> = [
      ['BEGIN;\nALTER TABLE public.tables DROP COLUMN status;\nCOMMIT;\n', 'DROP_COLUMN'],
      [
        'BEGIN;\nALTER TABLE public.hand_history ALTER COLUMN pot_total TYPE bigint;\nCOMMIT;\n',
        'ALTER_COLUMN_TYPE',
      ],
      [
        'BEGIN;\nALTER TABLE public.tables RENAME COLUMN max_players TO seat_cap;\nCOMMIT;\n',
        'RENAME_COLUMN',
      ],
      ['BEGIN;\nALTER TABLE public.tables RENAME TO poker_tables;\nCOMMIT;\n', 'RENAME_TABLE'],
    ];
    for (const [sql, expectedKind] of cases) {
      const res = checkMigrationNMinus1Compat('20261128010001_break.sql', sql, servingIndex);
      expect(res.ok, expectedKind).toBe(false);
      expect(res.violations[0].kind).toBe(expectedKind);
    }
  });

  it('refuses DROP FUNCTION when referenced in server/src or shared src RPC callers', () => {
    const serverDrop =
      'BEGIN;\nDROP FUNCTION IF EXISTS public.fn_record_hand_result(uuid);\nCOMMIT;\n';
    const r1 = checkMigrationNMinus1Compat('20261128010002_drop_fn.sql', serverDrop, servingIndex);
    expect(r1.ok).toBe(false);
    expect(r1.violations[0]).toMatchObject({
      kind: 'DROP_FUNCTION',
      target: 'public.fn_record_hand_result',
    });

    const clientDrop = 'BEGIN;\nDROP FUNCTION public.fn_client_wallet_summary();\nCOMMIT;\n';
    const r2 = checkMigrationNMinus1Compat('20261128010003_drop_rpc.sql', clientDrop, servingIndex);
    expect(r2.ok).toBe(false);
    expect(r2.violations[0].references).toContain('src/services/walletService.ts');
  });

  it('refuses ADD COLUMN NOT NULL without DEFAULT on a table referenced by N-1 serving code', () => {
    const sql =
      'BEGIN;\nALTER TABLE public.hand_history ADD COLUMN rake_bucket text NOT NULL;\nCOMMIT;\n';
    const res = checkMigrationNMinus1Compat('20261128010004_not_null.sql', sql, servingIndex);
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toMatchObject({
      kind: 'ADD_COLUMN_NOT_NULL_NO_DEFAULT',
      target: 'public.hand_history.rake_bucket',
    });
  });

  it('checks daily-maintenance window migrations as strictly as ordinary migrations (rollback safety)', () => {
    const windowSql = [
      '-- @install-window: daily-maintenance',
      '-- @locks: public.tables',
      'BEGIN;',
      'ALTER TABLE public.tables DROP COLUMN max_players;',
      'COMMIT;',
    ].join('\n');
    const res = checkMigrationNMinus1Compat(
      '20261128010005_window_drop.sql',
      windowSql,
      servingIndex
    );
    expect(res.ok).toBe(false);
    expect(res.violations[0].kind).toBe('DROP_COLUMN');
  });

  it('handles multi-action ALTER TABLE statements and catches breaking clauses alongside safe ones', () => {
    const sql = `BEGIN;
ALTER TABLE public.tables
  ADD COLUMN safe_nullable text,
  ADD COLUMN safe_default integer NOT NULL DEFAULT 0,
  DROP COLUMN IF EXISTS status;
COMMIT;`;
    const ops = extractBreakingDdlOps(sql);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'DROP_COLUMN', table: 'tables', column: 'status' });
    const res = checkMigrationNMinus1Compat('20261128010006_multi.sql', sql, servingIndex);
    expect(res.ok).toBe(false);
  });

  it('allows safe expand-and-contract migrations and unreferenced/temp objects', () => {
    const safeCases = [
      'BEGIN;\nALTER TABLE public.tables ADD COLUMN next_flag boolean;\nCOMMIT;\n',
      'BEGIN;\nALTER TABLE public.tables ADD COLUMN next_flag boolean NOT NULL DEFAULT false;\nCOMMIT;\n',
      "BEGIN;\nALTER TABLE public.tables ADD COLUMN next_flag text DEFAULT 'ok' NOT NULL;\nCOMMIT;\n",
      'BEGIN;\nALTER TABLE public.tables ADD COLUMN computed int GENERATED ALWAYS AS (1) STORED NOT NULL;\nCOMMIT;\n',
      'BEGIN;\nCREATE OR REPLACE FUNCTION public.fn_record_hand_result(p_id int) RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;\nCOMMIT;\n',
      'BEGIN;\nDROP TABLE IF EXISTS public.legacy_removed_table;\nCOMMIT;\n',
      'BEGIN;\nDROP TABLE IF EXISTS pg_temp.hand_history;\nCOMMIT;\n',
      '-- DROP TABLE public.hand_history;\nBEGIN;\nSELECT 1;\nCOMMIT;\n',
    ];
    for (const sql of safeCases) {
      const res = checkMigrationNMinus1Compat('20261128010007_safe.sql', sql, servingIndex);
      expect(res.ok, sql).toBe(true);
      expect(res.violations).toEqual([]);
    }
  });

  it('honors explicit -- @n-minus-1-safe: <reason> and rejects empty reasons', () => {
    const breaking = 'BEGIN;\nALTER TABLE public.tables DROP COLUMN status;\nCOMMIT;\n';
    expect(isNMinus1SafeAnnotated(breaking)).toBe(false);
    expect(isNMinus1SafeAnnotated('-- @n-minus-1-safe: \n' + breaking)).toBe(false);
    expect(isNMinus1SafeAnnotated('-- @n-minus-1-safe: ok\n' + breaking)).toBe(false);

    const annotated =
      '-- @n-minus-1-safe: verified column unused by serving engine after phase-1 drain\n' +
      breaking;
    expect(isNMinus1SafeAnnotated(annotated)).toBe(true);
    const res = checkMigrationNMinus1Compat('20261128010008_exempt.sql', annotated, servingIndex);
    expect(res.ok).toBe(true);
    expect(res.annotatedSafe).toBe(true);
  });

  it('scans the real repository server/src and src trees cleanly', () => {
    const realIndex = buildServingReferenceIndex(ROOT);
    const dropReal = 'BEGIN;\nDROP TABLE public.hand_history;\nCOMMIT;\n';
    const res = checkMigrationNMinus1Compat('20261128010009_real.sql', dropReal, realIndex);
    expect(res.ok).toBe(false);
    expect(res.violations[0].references.length).toBeGreaterThan(0);
  });

  it('catches destructive DDL inside DO $$ ... IF / ELSIF / FOR / EXCEPTION blocks', () => {
    const idx = makeIndex({
      'server/src/engine/SeatService.ts': `
        export async function loadSeats(db: any) {
          return db.from('table_seats').select('id, stack, status');
        }
      `,
    });
    const doIfDrop = `
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1) THEN
    ALTER TABLE public.table_seats DROP COLUMN stack;
  END IF;
END $$;
COMMIT;
`;
    const r1 = checkMigrationNMinus1Compat('20261128010010_do_if_drop.sql', doIfDrop, idx);
    expect(r1.ok).toBe(false);
    expect(r1.violations).toHaveLength(1);
    expect(r1.violations[0]).toMatchObject({
      kind: 'DROP_COLUMN',
      target: 'public.table_seats.stack',
    });

    const doLoopExcept = `
BEGIN;
DO $$
DECLARE
  v_ok boolean := true;
BEGIN
  FOR r IN SELECT 1 LOOP
    ALTER TABLE public.table_seats DROP COLUMN status;
  END LOOP;
EXCEPTION WHEN others THEN
  DROP TABLE public.table_seats;
END $$;
COMMIT;
`;
    const ops = extractBreakingDdlOps(doLoopExcept);
    expect(ops.map((o: any) => o.kind)).toEqual(['DROP_COLUMN', 'DROP_TABLE']);
  });

  it('catches destructive DDL executed dynamically via EXECUTE and EXECUTE format(...)', () => {
    const execDirect = `
BEGIN;
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.tables DROP COLUMN status';
END $$;
COMMIT;
`;
    const r1 = checkMigrationNMinus1Compat(
      '20261128010011_exec_direct.sql',
      execDirect,
      servingIndex
    );
    expect(r1.ok).toBe(false);
    expect(r1.violations[0]).toMatchObject({
      kind: 'DROP_COLUMN',
      target: 'public.tables.status',
    });

    const execFormat = `
BEGIN;
DO $$
BEGIN
  EXECUTE format('ALTER TABLE %I.%I DROP COLUMN %I', 'public', 'tables', 'max_players');
END $$;
COMMIT;
`;
    const r2 = checkMigrationNMinus1Compat(
      '20261128010012_exec_format.sql',
      execFormat,
      servingIndex
    );
    expect(r2.ok).toBe(false);
    expect(r2.violations[0]).toMatchObject({
      kind: 'DROP_COLUMN',
      target: 'public.tables.max_players',
    });
  });

  it('ignores -- @n-minus-1-safe: waivers hidden inside single-quoted strings or dollar-quoted bodies', () => {
    const spoofedString = `
BEGIN;
INSERT INTO public.audit_notes (body) VALUES ('
-- @n-minus-1-safe: spoofed waiver hidden inside single-quoted literal
');
ALTER TABLE public.tables DROP COLUMN status;
COMMIT;
`;
    expect(isNMinus1SafeAnnotated(spoofedString)).toBe(false);
    const r1 = checkMigrationNMinus1Compat(
      '20261128010013_spoof_str.sql',
      spoofedString,
      servingIndex
    );
    expect(r1.ok).toBe(false);
    expect(r1.annotatedSafe).toBe(false);

    const spoofedDollar = `
BEGIN;
DO $$
BEGIN
  PERFORM $msg$
-- @n-minus-1-safe: spoofed waiver hidden inside dollar-quoted body
$msg$;
END $$;
ALTER TABLE public.tables DROP COLUMN status;
COMMIT;
`;
    expect(isNMinus1SafeAnnotated(spoofedDollar)).toBe(false);
    const r2 = checkMigrationNMinus1Compat(
      '20261128010014_spoof_dollar.sql',
      spoofedDollar,
      servingIndex
    );
    expect(r2.ok).toBe(false);
  });
});
