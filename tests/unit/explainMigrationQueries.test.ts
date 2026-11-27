import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import {
  analyzeExplainPlan,
  extractExplainableQueries,
} from '../../scripts/ci/explain-migration-queries.mjs';

describe('explain-migration-queries query extractor', () => {
  it('extracts standalone view queries and marks parameterized routine queries', () => {
    const sql = `
BEGIN;
CREATE OR REPLACE VIEW public.v_spin_reserve_health AS
SELECT c.id, COALESCE(s.total_amt, 0) AS total_amt
FROM public.clubs c
LEFT JOIN (
  SELECT club_id, SUM(amount) AS total_amt
  FROM public.spin_reserve_ledger
  GROUP BY club_id
) s ON s.club_id = c.id;

CREATE OR REPLACE FUNCTION public.bbj_drift_since(p_since timestamptz)
RETURNS TABLE(pool_id uuid, drift numeric)
LANGUAGE sql
AS $fn$
  SELECT p.id, COALESCE(b.total, 0)
  FROM public.bbj_pools p
  LEFT JOIN (
    SELECT pool_id, SUM(amount) AS total
    FROM public.bbj_contributions
    WHERE created_at >= p_since
    GROUP BY pool_id
  ) b ON b.pool_id = p.id;
$fn$;
COMMIT;
`;
    const queries = extractExplainableQueries(sql);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({
      source: 'view public.v_spin_reserve_health',
      kind: 'view',
      parameterized: false,
    });
    expect(queries[1]).toMatchObject({
      source: 'function public.bbj_drift_since #1',
      kind: 'function',
      parameterized: true,
    });
  });
});

describe('explain-migration-queries EXPLAIN (FORMAT JSON) plan analyzer', () => {
  it('flags a correlated SubPlan scanning a hot table (the #12129 bbj_drift_since & pre-fix v_spin_reserve_health signature)', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'bbj_pools',
          'Total Cost': 45000,
          'Plan Rows': 120,
          Plans: [
            {
              'Node Type': 'Aggregate',
              'Parent Relationship': 'SubPlan',
              'Subplan Name': 'SubPlan 1',
              'Total Cost': 350,
              'Plan Rows': 1,
              Plans: [
                {
                  'Node Type': 'Index Scan',
                  'Parent Relationship': 'Outer',
                  'Relation Name': 'bbj_contributions',
                  'Total Cost': 349,
                  'Plan Rows': 40,
                },
              ],
            },
          ],
        },
      },
    ];
    const res = analyzeExplainPlan(plan);
    expect(res.ok).toBe(false);
    expect(res.findings.some((f: any) => f.code === 'CORRELATED_SUBPLAN_HOT_TABLE')).toBe(true);
    expect(res.stats.subPlans).toHaveLength(1);
    expect(res.stats.subPlans[0].table).toBe('bbj_contributions');
  });

  it('flags a Seq Scan on a hot table and a Nested Loop inner Seq Scan', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Nested Loop',
          'Total Cost': 150000,
          'Plan Rows': 500,
          Plans: [
            {
              'Node Type': 'Index Scan',
              'Relation Name': 'clubs',
              'Total Cost': 10,
              'Plan Rows': 10,
            },
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'chip_ledger',
              'Total Cost': 120000,
              'Plan Rows': 25000000,
            },
          ],
        },
      },
    ];
    const res = analyzeExplainPlan(plan);
    expect(res.ok).toBe(false);
    const codes = res.findings.map((f: any) => f.code);
    expect(codes).toContain('SEQ_SCAN_HOT_TABLE');
    expect(codes).toContain('NESTED_LOOP_INNER_SEQ_SCAN');
    expect(codes).toContain('EXCESSIVE_PLAN_COST');
  });

  it('passes a single-pass Index Scan + HashAggregate plan cleanly', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Hash Left Join',
          'Total Cost': 420.5,
          'Plan Rows': 80,
          Plans: [
            {
              'Node Type': 'Seq Scan',
              'Relation Name': 'bbj_pools',
              'Total Cost': 12,
              'Plan Rows': 80,
            },
            {
              'Node Type': 'HashAggregate',
              'Total Cost': 405,
              'Plan Rows': 80,
              Plans: [
                {
                  'Node Type': 'Index Only Scan',
                  'Relation Name': 'bbj_contributions',
                  'Index Name': 'idx_bbj_contributions_created_at_pool_id',
                  'Total Cost': 380,
                  'Plan Rows': 2000,
                },
              ],
            },
          ],
        },
      },
    ];
    const res = analyzeExplainPlan(plan);
    expect(res.ok).toBe(true);
    expect(res.findings).toEqual([]);
  });
});
