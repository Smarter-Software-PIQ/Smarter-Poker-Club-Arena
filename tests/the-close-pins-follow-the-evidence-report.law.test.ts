/**
 * THE CLOSE'S PINS FOLLOW THE EVIDENCE REPORT (2026-11-07).
 *
 * 20261107021911 changed fn_union_pnl_evidence_report (md5 ca8931142b.. ->
 * b36f9e2528..) without moving the two pins on its old body, so
 * original_inventory_proof_sources_match() went false, the original-inventory
 * generation went NULL, every close certificate stopped being read or written
 * and the advance fell back to proving a week's flows in one statement that
 * job 272 cannot fit. 20261107234051 moves both pins.
 *
 * Pinned here:
 *   1. the migration moves exactly the report pin in the advance and the
 *      report and advance entries of the 65-source list, md5-pinned pre and
 *      post, metadata unchanged, and proves the list holds afterwards;
 *   2. no later migration pins the report's pre-021911 body again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261107234051_the_close_pins_follow_the_evidence_report.sql';
const sql = readFileSync(join(MIGRATIONS, FILE), 'utf8');
const code = sql.replace(/^--[^\n]*/gm, '');

describe('the close pins follow the evidence report', () => {
  it('moves the advance pin from the old report body to the installed one', () => {
    expect(code).toContain("old_report constant text := 'ca8931142b7e8ad6bbac07bd0913d268'");
    expect(code).toContain("new_report constant text := 'b36f9e252823addb55be086a26f3dedf'");
    expect(code).toContain('p := replace(d, old_report, new_report);');
    expect(code).toMatch(/\(length\(d\)-length\(replace\(d,old_report,''\)\)\)\/32 <> 1/);
    expect(code).toContain("'a7cd837baeff4a3f2bfbad0f17f323b8'");
    expect(code).toContain("'4b5bc9cae04ce0f98ce56381b7dd524f'");
  });

  it('moves the report and advance entries of the 65-source list and proves the list holds', () => {
    expect(code).toContain("'5751413734130d759efc720fbc598c92'");
    expect(code).toContain("'bb3f5552448e42e7d55c470d49591049'");
    expect(code).toContain(
      'replace(replace(d, e_report_old, e_report_new), e_adv_old, replace(e_adv_old, old_adv, adv_now))'
    );
    expect(code).toContain(
      'IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN'
    );
    expect(code.match(/IF m2 IS DISTINCT FROM m/g)).toHaveLength(2);
    expect(sql).toMatch(
      /@live-proof: smarter_private\.original_inventory_proof_sources_match\(\) IS TRUE/
    );
  });

  it('no later migration pins the pre-021911 report body', () => {
    const newer = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f > FILE);
    for (const f of newer) {
      const text = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/^--[^\n]*/gm, '');
      expect(text, `${f} pins the old evidence report`).not.toMatch(
        /'ca8931142b7e8ad6bbac07bd0913d268'\s*\)/
      );
    }
  });
});
