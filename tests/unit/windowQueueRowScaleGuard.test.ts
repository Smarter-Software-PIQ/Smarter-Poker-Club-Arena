import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
// @ts-expect-error plain ESM helper
import {
  HOT_TABLES,
  HOT_TABLE_ROW_THRESHOLD,
  parseTableStats,
  seedTableStatsSQL,
  extractHotTableInstallStatements,
  isHotTablePlanExempt,
  analyzeExplainPlan,
  evaluateHotTablePlans,
} from '../../scripts/ci/window-queue-rehearsal.mjs';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('row-scale statistics capture & hot-table query-plan guard', () => {
  it('captures non-sensitive table cardinality metadata in the default-branch read-only capture job', () => {
    const wf = parse(
      read('.github/workflows/window-migrations-install-before-merge.yml')
    ) as Record<string, any>;
    const { capture, rehearse, guards } = wf.jobs;

    const exportStep = capture.steps.find((s: any) =>
      String(s.name ?? '').includes('Export the schema')
    );
    expect(exportStep).toBeDefined();
    expect(exportStep.run).toContain('pg_stat_user_tables');
    expect(exportStep.run).toContain('pg_relation_size');
    expect(exportStep.run).toContain('est_rows');
    expect(exportStep.run).toContain("('public', 'smarter_private')");
    expect(exportStep.run).toContain('default_transaction_read_only=on');
    expect(exportStep.run).toContain('table-stats.json');

    const uploadStep = capture.steps.find((s: any) =>
      String(s.uses ?? '').startsWith('actions/upload-artifact')
    );
    expect(uploadStep.with.name).toBe('window-rehearsal-schema');
    expect(uploadStep.with.path).toContain('table-stats.json');

    // Trusted-by-construction boundary preserved: zero PR code in capture, zero secrets in rehearse/guards.
    expect(JSON.stringify(capture)).not.toContain('head.sha');
    expect(rehearse.environment).toBeUndefined();
    expect(JSON.stringify(rehearse)).not.toContain('secrets.');

    const rehearseStep = rehearse.steps.find((s: any) =>
      String(s.run ?? '').includes('rehearse-window-queue.sh')
    );
    expect(rehearseStep.env.TABLE_STATS).toBe('${{ runner.temp }}/in/table-stats.json');
    expect(rehearseStep.env.REHEARSAL_ADMIN_PSQL).toBe(
      'docker exec -i -e PGPASSWORD=rehearsal-only window-rehearsal-db psql -U supabase_admin -d postgres'
    );

    // N-1 compatibility guard wired into the secretless guards job.
    expect(JSON.stringify(guards)).toContain('scripts/ci/check-migration-n-minus-1-compat.mjs');
  });

  it('wires REHEARSAL_ADMIN_PSQL into rehearse-window-queue.sh and fails closed when seed-stats fails', () => {
    const sh = read('scripts/ci/rehearse-window-queue.sh');
    expect(sh).toContain('REHEARSAL_ADMIN_PSQL');
    expect(sh).toContain('ADMIN_PSQL');
    expect(sh).toMatch(/seed-stats[\s\S]*?"\$\{ADMIN_PSQL\[@\]\}"/);
    expect(sh).not.toContain('warning: could not seed row-scale stats');

    // Runtime execution check: when REHEARSAL_ADMIN_PSQL fails to seed pg_class stats,
    // rehearse-window-queue.sh must exit 1 (fail closed) even if regular PSQL succeeds.
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-seed-fail-'));
    try {
      const migDir = join(dir, 'mig');
      const evidenceDir = join(dir, 'evidence');
      mkdirSync(migDir, { recursive: true });
      writeFileSync(join(dir, 'installed.txt'), '20261128000000\n');
      writeFileSync(join(dir, 'changed.txt'), 'supabase/migrations/20261128000002_changed.sql\n');
      writeFileSync(
        join(dir, 'table-stats.json'),
        JSON.stringify([
          { schemaname: 'public', relname: 'hand_history', est_rows: 200000, rel_bytes: 1e8 },
        ])
      );
      writeFileSync(
        join(migDir, '20261128000001_prereq.sql'),
        '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n'
      );
      writeFileSync(
        join(migDir, '20261128000002_changed.sql'),
        "-- @install-window: daily-maintenance\nBEGIN;\nCREATE INDEX idx_hh_note ON public.hand_history (note);\nUPDATE public.hand_history SET status = 'done' WHERE note = 'x';\nCOMMIT;\n"
      );
      const traceFile = join(dir, 'trace.log');
      const fakePsql = join(dir, 'fake-psql.mjs');
      writeFileSync(
        fakePsql,
        `import { appendFileSync, readFileSync } from 'node:fs';
const role = process.argv[2];
const mode = process.argv[3];
const sql = readFileSync(0, 'utf8');
appendFileSync(${JSON.stringify(traceFile)}, role + ':' + (sql.includes('pg_catalog.pg_class') ? 'SEED' : sql.includes('EXPLAIN (FORMAT JSON)') ? 'EXPLAIN' : sql.includes('20261128000001_prereq.sql') ? 'INSTALL_M1' : sql.includes('20261128000002_changed.sql') ? 'INSTALL_M2' : 'OTHER') + '\\n');
if (role === 'admin' && mode === 'fail-seed') {
  console.error('ERROR: permission denied for table pg_class');
  process.exit(1);
}
if (sql.includes('EXPLAIN (FORMAT JSON)')) {
  const hasIdx = sql.includes('CREATE INDEX idx_hh_note');
  console.log(JSON.stringify([{ Plan: { 'Node Type': hasIdx ? 'Index Scan' : 'Seq Scan', 'Relation Name': 'hand_history', Schema: 'public' } }]));
}
`
      );

      // 1. Seed failure via REHEARSAL_ADMIN_PSQL -> fails closed (exit 1).
      const failRun = spawnSync('bash', [resolve(ROOT, 'scripts/ci/rehearse-window-queue.sh')], {
        env: {
          ...process.env,
          REHEARSAL_PSQL: `node ${fakePsql} regular ok`,
          REHEARSAL_ADMIN_PSQL: `node ${fakePsql} admin fail-seed`,
          MIG_DIR: migDir,
          INSTALLED: join(dir, 'installed.txt'),
          CHANGED: join(dir, 'changed.txt'),
          TABLE_STATS: join(dir, 'table-stats.json'),
          EVIDENCE: evidenceDir,
        },
        encoding: 'utf8',
      });
      expect(failRun.status).toBe(1);
      expect(readFileSync(join(evidenceDir, 'summary.md'), 'utf8')).toContain(
        'REFUSED** row-scale planner stats could not be seeded'
      );
      expect(readFileSync(traceFile, 'utf8')).toContain('admin:SEED');

      // 2. Healthy seed -> M1 installs BEFORE M2 EXPLAIN, and M2 EXPLAIN runs BEFORE M2 installs.
      writeFileSync(traceFile, '');
      const okRun = spawnSync('bash', [resolve(ROOT, 'scripts/ci/rehearse-window-queue.sh')], {
        env: {
          ...process.env,
          REHEARSAL_PSQL: `node ${fakePsql} regular ok`,
          REHEARSAL_ADMIN_PSQL: `node ${fakePsql} admin ok`,
          MIG_DIR: migDir,
          INSTALLED: join(dir, 'installed.txt'),
          CHANGED: join(dir, 'changed.txt'),
          TABLE_STATS: join(dir, 'table-stats.json'),
          EVIDENCE: join(dir, 'evidence-ok'),
        },
        encoding: 'utf8',
      });
      expect(okRun.status).toBe(0);
      const events = readFileSync(traceFile, 'utf8').trim().split('\n');
      expect(events[0]).toBe('admin:SEED');
      expect(events.indexOf('regular:INSTALL_M1')).toBeLessThan(events.indexOf('regular:EXPLAIN'));
      expect(events.indexOf('regular:EXPLAIN')).toBeLessThan(events.indexOf('regular:INSTALL_M2'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates and builds safe pg_class reltuples/relpages seed SQL', () => {
    expect(HOT_TABLE_ROW_THRESHOLD).toBe(50_000);
    expect(HOT_TABLES).toEqual(
      expect.arrayContaining([
        'hand_history',
        'chip_ledger',
        'diamonds_ledger',
        'table_seats',
        'tournaments',
      ])
    );

    const stats = parseTableStats(
      JSON.stringify([
        { schemaname: 'public', relname: 'hand_history', est_rows: 1200000, rel_bytes: 819200000 },
        {
          schemaname: 'public',
          relname: 'chip_ledger',
          est_rows: 25000000,
          rel_bytes: 4096000000,
          rel_pages: 500000,
        },
        { schemaname: 'public', relname: 'small_cfg', est_rows: 10, rel_bytes: 8192 },
        // Unsafe identifiers must be rejected/ignored rather than interpolated.
        { schemaname: 'public', relname: 'bad; DROP TABLE x;', est_rows: 999999, rel_bytes: 81920 },
      ])
    );
    expect(stats).toHaveLength(3);

    const sql = seedTableStatsSQL(stats);
    expect(sql).toContain("n.nspname = 'public' AND c.relname = 'hand_history'");
    expect(sql).toContain('reltuples = 1200000::real');
    expect(sql).toContain('relpages = 100000::integer');
    expect(sql).toContain("n.nspname = 'public' AND c.relname = 'chip_ledger'");
    expect(sql).toContain('relpages = 500000::integer');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('extracts install-time SELECT/UPDATE/DELETE statements on hot tables while ignoring function definitions', () => {
    const sql = `
-- Comment mentioning SELECT * FROM public.hand_history;
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_example() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.hand_history WHERE id = gen_random_uuid();
END;
$$;
UPDATE public.hand_history SET status = 'archived' WHERE unindexed_note = 'old';
WITH stale AS (SELECT id FROM public.chip_ledger WHERE note = 'x')
DELETE FROM public.chip_ledger WHERE id IN (SELECT id FROM stale);
SELECT count(*) FROM public.small_config_table;
COMMIT;
`;
    const stmts = extractHotTableInstallStatements(sql, new Set(['hand_history', 'chip_ledger']));
    expect(stmts).toHaveLength(2);
    expect(stmts[0].statement).toContain('UPDATE public.hand_history');
    expect(stmts[0].tables).toEqual(['hand_history']);
    expect(stmts[1].statement).toContain('DELETE FROM public.chip_ledger');
    expect(stmts[1].tables).toEqual(['chip_ledger']);
  });

  it('refuses Seq Scan on high-cardinality hot tables and allows indexed scans or low-cardinality tables', () => {
    const hotStats = new Map([
      [
        'hand_history',
        { schemaname: 'public', relname: 'hand_history', est_rows: 500_000, rel_bytes: 1e8 },
      ],
      [
        'tournaments',
        { schemaname: 'public', relname: 'tournaments', est_rows: 12_000, rel_bytes: 1e6 },
      ],
    ]);

    const seqScanPlan = [
      {
        Plan: {
          'Node Type': 'ModifyTable',
          'Relation Name': 'hand_history',
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'hand_history',
              Schema: 'public',
              Filter: "(unindexed_col = 'x'::text)",
              'Total Cost': 142000.5,
              'Plan Rows': 100,
            },
          ],
        },
      },
    ];
    const findings = analyzeExplainPlan(seqScanPlan, hotStats);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      table: 'hand_history',
      nodeType: 'Seq Scan',
      estRows: 500_000,
    });

    const indexScanPlan = [
      {
        Plan: {
          'Node Type': 'ModifyTable',
          'Relation Name': 'hand_history',
          Plans: [
            {
              'Node Type': 'Index Scan',
              'Index Name': 'hand_history_pkey',
              'Relation Name': 'hand_history',
              Schema: 'public',
              'Total Cost': 8.45,
              'Plan Rows': 1,
            },
          ],
        },
      },
    ];
    expect(analyzeExplainPlan(indexScanPlan, hotStats)).toEqual([]);

    // Below 50,000 rows threshold -> allowed.
    const smallSeqScan = [
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'tournaments',
          Schema: 'public',
          'Total Cost': 250,
          'Plan Rows': 10,
        },
      },
    ];
    expect(analyzeExplainPlan(smallSeqScan, hotStats)).toEqual([]);
  });

  it('honors explicit @probe-exempt without letting unrelated function exemptions bypass hot-table guards', () => {
    const baseSql =
      "BEGIN;\nUPDATE public.hand_history SET status = 'done' WHERE raw_flag = true;\nCOMMIT;\n";
    expect(isHotTablePlanExempt(baseSql, 'hand_history')).toBe(false);
    expect(
      isHotTablePlanExempt(
        '-- @probe-exempt: public.fn_unrelated_rpc external dblink call\n' + baseSql,
        'hand_history'
      )
    ).toBe(false);
    expect(
      isHotTablePlanExempt(
        '-- @probe-exempt: hand_history bounded maintenance backfill verified on replica\n' +
          baseSql,
        'hand_history'
      )
    ).toBe(true);
    expect(
      isHotTablePlanExempt(
        '-- @probe-exempt: query-plan reviewed and bounded\n' + baseSql,
        'hand_history'
      )
    ).toBe(true);
  });

  it('evaluateHotTablePlans refuses unindexed hot-table Seq Scan and passes when exempt or indexed', () => {
    const stats = [
      { schemaname: 'public', relname: 'chip_ledger', est_rows: 2_500_000, rel_bytes: 500_000_000 },
    ];
    const badSql = "BEGIN;\nDELETE FROM public.chip_ledger WHERE memo = 'bad';\nCOMMIT;\n";
    const runExplain = vi.fn().mockReturnValue([
      {
        Plan: {
          'Node Type': 'ModifyTable',
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'chip_ledger',
              Schema: 'public',
              Filter: "(memo = 'bad'::text)",
              'Total Cost': 500000,
              'Plan Rows': 2,
            },
          ],
        },
      },
    ]);

    const refused = evaluateHotTablePlans('20261128000001_bad.sql', badSql, stats, runExplain);
    expect(refused.ok).toBe(false);
    expect(refused.violations).toHaveLength(1);
    expect(refused.violations[0].table).toBe('chip_ledger');
    expect(runExplain).toHaveBeenCalledTimes(1);

    const exemptSql = '-- @probe-exempt: chip_ledger verified offline\n' + badSql;
    const exempted = evaluateHotTablePlans(
      '20261128000002_exempt.sql',
      exemptSql,
      stats,
      runExplain
    );
    expect(exempted.ok).toBe(true);
    expect(exempted.violations).toEqual([]);
    expect(runExplain).toHaveBeenCalledTimes(1); // Skipped EXPLAIN because exempt
  });

  it('extracts INSERT ... SELECT and PL/pgSQL DO / IF ... THEN hot-table install statements', () => {
    const insertSql = `
BEGIN;
INSERT INTO public.hand_history_archive
SELECT * FROM public.hand_history WHERE unindexed_note = 'old';
COMMIT;
`;
    const insertStmts = extractHotTableInstallStatements(insertSql, new Set(['hand_history']));
    expect(insertStmts).toHaveLength(1);
    expect(insertStmts[0].statement).toMatch(/^INSERT INTO public\.hand_history_archive/i);
    expect(insertStmts[0].tables).toEqual(['hand_history']);

    const doIfSql = `
BEGIN;
DO $$
DECLARE
  v_flag boolean := true;
BEGIN
  IF v_flag THEN
    UPDATE public.hand_history SET status = 'archived' WHERE unindexed_note = 'old';
  ELSIF false THEN
    DELETE FROM public.hand_history WHERE unindexed_note = 'stale';
  END IF;
EXCEPTION WHEN others THEN
  INSERT INTO public.archive SELECT * FROM public.hand_history WHERE unindexed_note = 'err';
END $$;
COMMIT;
`;
    const doStmts = extractHotTableInstallStatements(doIfSql, new Set(['hand_history']));
    expect(doStmts).toHaveLength(3);
    expect(doStmts[0].statement).toMatch(/^UPDATE public\.hand_history/i);
    expect(doStmts[1].statement).toMatch(/^DELETE FROM public\.hand_history/i);
    expect(doStmts[2].statement).toMatch(/^INSERT INTO public\.archive/i);
  });

  it('executes preceding same-migration DDL before EXPLAIN and visibly reports non-variable EXPLAIN failures', () => {
    const stats = [
      { schemaname: 'public', relname: 'hand_history', est_rows: 500_000, rel_bytes: 1e8 },
    ];

    // 1. CREATE INDEX before UPDATE -> planner sees the index and picks Index Scan (no false positive).
    const idxThenUpdate = `
BEGIN;
CREATE INDEX idx_hh_unindexed_note ON public.hand_history (unindexed_note);
UPDATE public.hand_history SET status = 'archived' WHERE unindexed_note = 'old';
COMMIT;
`;
    const seenContexts: any[] = [];
    const idxResult = evaluateHotTablePlans(
      '20261128000010_idx_then_update.sql',
      idxThenUpdate,
      stats,
      (_stmt: string, _file: string, ctx: any) => {
        seenContexts.push(ctx);
        const hasIndex = (ctx?.precedingDdl ?? []).some((d: string) =>
          /CREATE\s+INDEX\s+idx_hh_unindexed_note\b/i.test(d)
        );
        return {
          plan: [
            {
              Plan: {
                'Node Type': 'ModifyTable',
                Plans: [
                  hasIndex
                    ? {
                        'Node Type': 'Index Scan',
                        'Index Name': 'idx_hh_unindexed_note',
                        'Relation Name': 'hand_history',
                        Schema: 'public',
                      }
                    : {
                        'Node Type': 'Seq Scan',
                        'Relation Name': 'hand_history',
                        Schema: 'public',
                      },
                ],
              },
            },
          ],
          error: null,
        };
      }
    );
    expect(idxResult.ok).toBe(true);
    expect(idxResult.violations).toEqual([]);
    expect(seenContexts[0]?.precedingDdl).toEqual([
      expect.stringMatching(/CREATE INDEX idx_hh_unindexed_note/i),
    ]);

    // 2. ALTER TABLE ADD COLUMN before UPDATE -> EXPLAIN sees new_col and catches Seq Scan.
    const addColThenUpdate = `
BEGIN;
ALTER TABLE public.hand_history ADD COLUMN new_col text;
UPDATE public.hand_history SET new_col = 'x' WHERE unindexed_note = 'old';
COMMIT;
`;
    const addColResult = evaluateHotTablePlans(
      '20261128000011_add_col_then_update.sql',
      addColThenUpdate,
      stats,
      (_stmt: string, _file: string, ctx: any) => {
        const hasCol = (ctx?.precedingDdl ?? []).some((d: string) =>
          /ADD\s+COLUMN\s+new_col\b/i.test(d)
        );
        if (!hasCol) {
          return {
            plan: null,
            error: 'ERROR:  column "new_col" of relation "hand_history" does not exist',
          };
        }
        return {
          plan: [
            {
              Plan: {
                'Node Type': 'Seq Scan',
                'Relation Name': 'hand_history',
                Schema: 'public',
              },
            },
          ],
          error: null,
        };
      }
    );
    expect(addColResult.ok).toBe(false);
    expect(addColResult.violations).toHaveLength(1);
    expect(addColResult.explainErrors).toEqual([]);

    // 3. Non-variable EXPLAIN error is visibly reported (not silently swallowed),
    // while a DO-block declared variable error is skipped as variable-bound.
    const brokenTopLevel =
      "BEGIN;\nUPDATE public.hand_history SET missing_col = 'x' WHERE id = 1;\nCOMMIT;\n";
    const errResult = evaluateHotTablePlans(
      '20261128000012_explain_err.sql',
      brokenTopLevel,
      stats,
      () => ({
        plan: null,
        error: 'ERROR:  column "missing_col" of relation "hand_history" does not exist',
      })
    );
    expect(errResult.explainErrors).toHaveLength(1);
    expect(errResult.explainErrors[0].error).toContain('missing_col');

    const doVarSql = `
BEGIN;
DO $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.hand_history SET status = 'done' WHERE id = v_id;
END $$;
COMMIT;
`;
    const varResult = evaluateHotTablePlans('20261128000013_do_var.sql', doVarSql, stats, () => ({
      plan: null,
      error: 'ERROR:  column "v_id" does not exist',
    }));
    expect(varResult.explainErrors).toEqual([]);
    expect(varResult.skippedVariableExplain).toBe(1);
  });
});
