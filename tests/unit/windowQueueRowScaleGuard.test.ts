import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

    // N-1 compatibility guard wired into the secretless guards job.
    expect(JSON.stringify(guards)).toContain('scripts/ci/check-migration-n-minus-1-compat.mjs');
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
});
