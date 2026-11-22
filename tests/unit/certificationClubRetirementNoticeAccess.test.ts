/**
 * A CERTIFICATION CLUB RETIRES PAST ITS NOTICE ACCESS PROJECTION (2026-11-21).
 * Cert Residue Sweep run 44846022061 failed on Preset Crest Cert 179495002644:
 * fn_ca_retire_certification_club deleted the club while one
 * club_notice_access_events row (a NO ACTION foreign key) still named it.
 * The migration removes that projection immediately before the club delete,
 * after the members (whose removal re-publishes it), and nowhere else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261121005200_certification_club_retirement_removes_its_notice_access_proj.sql'
  ),
  'utf8'
);

describe('certification club retirement and the notice access projection', () => {
  it('replaces the exact live preimage once, in one transaction', () => {
    expect(sql).toContain("IS DISTINCT FROM 'd31f4bfb33269140ffbf10e26ff7235c'");
    expect(sql).toContain('CERTIFICATION_CLUB_NOTICE_ACCESS_PATCH_MISMATCH');
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('deletes the projection after the members and right before the club', () => {
    const replacement = sql.slice(sql.indexOf('c_new constant text'), sql.indexOf('v_def text'));
    const projection = replacement.indexOf(
      'DELETE FROM public.club_notice_access_events WHERE club_id = p_club_id;'
    );
    const club = replacement.indexOf('DELETE FROM public.clubs WHERE id = p_club_id;');
    expect(projection).toBeGreaterThan(-1);
    expect(club).toBeGreaterThan(projection);
    expect(replacement).toContain('GET DIAGNOSTICS v_ev = ROW_COUNT;');
  });

  it('proves itself on a live club of the refused shape and never takes a hot-table lock', () => {
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_retire_certification_club$/m);
    expect(sql).toContain("RAISE EXCEPTION 'probe-unwind'");
    expect(sql).not.toMatch(/ALTER TABLE|ADD CONSTRAINT|LOCK TABLE/i);
  });
});
