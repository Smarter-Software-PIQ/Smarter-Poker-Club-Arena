/**
 * LAW: A CERTIFIED CASH CORRECTION NEEDS NO PER-CAUSE LIST (2026-11-21).
 *
 * Recovering one stranded cash hand (incident 887c0008) took a second
 * emergency migration only to add its cause to a hard-coded list inside
 * smarter_private.hand_source_correction_claim_guard; until it landed every
 * engine start failed with HAND_SOURCE_CORRECTION_LEASE_REFUSED. The list
 * repeated what certification (postgres-only) and the re-derived equal proof
 * already decide. 20261121185031 admits any certified cash proof whose
 * source_cause is a plain identifier and whose proof_version is a migration
 * version, keeps backup_residue_constraint behind its own live condition, and
 * changes nothing else.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '../supabase/migrations');
const FILE = '20261121185031_a_certified_cash_correction_claims_without_a_per_cause_list.sql';
const sql = readFileSync(resolve(DIR, FILE), 'utf8');
const anchorNew = /n text:=\$anchor\$([\s\S]*?)\$anchor\$;/.exec(sql)?.[1] ?? '';

describe('a certified cash correction needs no per-cause list', () => {
  it('replaces the guard from its exact preimage, once, keeping its security', () => {
    expect(sql.startsWith('-- @live-proof:')).toBe(true);
    expect(sql).toMatch(/md5\(d\)<>'e5b531a56e0c67c85f183a6a6e116aec'/);
    expect(sql).toMatch(
      /\/length\(o\)<>1 THEN RAISE EXCEPTION 'certified_cash_claim_anchor_refused'/
    );
    expect(sql).toMatch(/certified_cash_claim_security_refused/);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
  });

  it('admits any migration-certified cash cause but keeps the backup residue condition', () => {
    expect(anchorNew).toMatch(/ANY_CERTIFIED_CASH_CORRECTION_V1/);
    expect(anchorNew).toMatch(/<>'backup_residue_constraint'/);
    expect(anchorNew).toContain("proof_version','') ~ '^[0-9]{14}$'");
    expect(anchorNew).toMatch(/promo_position_left_behind_by_cash_seat_move/);
  });

  it('keeps every other check of the guard in its post-image assertion', () => {
    for (const kept of [
      'c.proof IS DISTINCT FROM proof',
      'HAND_SOURCE_CORRECTION_LEASE_REFUSED',
      'engine_table_leases',
      'cash_original17_fixed_sources_match',
    ]) {
      expect(sql).toContain(`position('${kept}' IN d)=0`);
    }
  });

  it('is not undone: no later migration reintroduces a closed per-cause cash list', () => {
    const later = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > FILE);
    for (const f of later) {
      const text = readFileSync(resolve(DIR, f), 'utf8');
      if (!text.includes('hand_source_correction_claim_guard')) continue;
      expect(text, `${f} must keep ANY_CERTIFIED_CASH_CORRECTION_V1`).toContain(
        'ANY_CERTIFIED_CASH_CORRECTION_V1'
      );
    }
  });
});
