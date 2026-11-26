/**
 * THE LANE DOCTRINE NAMES THE REMATCH REGISTRATION COPY (2026-11-25)
 *
 * 20261126000707 re-derived the heads-up rematch's copy of
 * fn_register_for_tournament from its installed source, so the copy calls
 * fn_ca_lock_tournament_registration_acquisition as its source does. Rule 7 of
 * fn_ca_settlement_lane_doctrine() pinned that gate's callers to exactly five
 * doors, so from the minute it installed the live-catalog doctrine check failed
 * on every pull request. Play was unaffected (for a rematch the gate is the
 * seat gate), but nothing before install could see it: the doctrine reads the
 * live catalog.
 *
 * So the rule that could have seen it is written down here: a migration that
 * re-derives the rematch copies proves the doctrine still holds before COMMIT.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((file) => /^\d{14}_.*\.sql$/.test(file));
const read = (file: string) => readFileSync(join(DIR, file), 'utf8');
const code = (sql: string) => sql.replace(/^\s*--[^\n]*$/gm, '');
const mine = files.filter((file) =>
  file.endsWith('_the_lane_doctrine_names_the_rematch_registration_copy.sql')
);
if (mine.length !== 1) throw new Error('Expected One Lane Doctrine Rematch Copy Migration');
const body = code(read(mine[0]));
const FIRST_REDERIVE = '20261126000707_heads_up_rematch_copies_follow_their_changed_sources.sql';
const DOORS =
  'fn_register_for_tournament,fn_register_for_tournament_with_ticket,fn_register_horse_for_tournament,fn_register_horse_for_tournament_to_target,fn_seat_late_registrant';

describe('the lane doctrine names the rematch registration copy', () => {
  it('is one transaction that patches one anchor of the reviewed doctrine', () => {
    expect(body.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(body.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(body).toContain("'217b2a2adab0c339ac48723a148d554c'");
    expect(body).toContain('LANE_DOCTRINE_REMATCH_COPY_PREIMAGE_CHANGED');
    expect(body).toContain("'LANE_DOCTRINE_REMATCH_COPY_ANCHOR: found % times, expected 1'");
    expect(body.match(/\bEXECUTE\b/g)).toHaveLength(1);
    expect(body).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
  });

  it('adds exactly one reviewed caller and keeps the five doors', () => {
    expect(body).toContain(`$a$IF v_set IS DISTINCT FROM '${DOORS}'$a$`);
    expect(body).toContain(
      `$b$IF v_set IS DISTINCT FROM 'fn_ca_rematch_register_for_payer,${DOORS}'$b$`
    );
  });

  it('refuses to commit unless the doctrine reports no violation and rule 7 keeps its seat-gate clause', () => {
    expect(body).toContain("'LANE_DOCTRINE_REMATCH_COPY: the doctrine still reports %'");
    expect(body).toContain("'LANE_DOCTRINE_REMATCH_COPY: rule 7 lost its seat-gate clause'");
    expect(read(mine[0])).toContain('-- @probe-for: public.fn_ca_settlement_lane_doctrine\n');
    // Patched through EXECUTE, so the merged-must-be-live law needs the proof said out loud.
    expect(read(mine[0])).toMatch(
      /^-- @live-proof: \(position\('fn_ca_rematch_register_for_payer,/m
    );
  });

  it('every migration that re-derives the rematch copies after the first proves the doctrine before COMMIT', () => {
    const missing = files
      .filter((file) => file > FIRST_REDERIVE)
      .map((file) => ({ file, sql: code(read(file)) }))
      .filter(({ sql }) => sql.includes('smarter_private.heads_up_rematch_rederive()'))
      .filter(({ sql }) => !/:=\s*public\.fn_ca_settlement_lane_doctrine\(\)/.test(sql))
      .map(({ file }) => file);
    expect(
      missing,
      'A re-derived rematch copy can gain or lose a lane call with its source. Read ' +
        'public.fn_ca_settlement_lane_doctrine() into a variable in the same transaction and ' +
        'refuse to commit unless it is ok (2026-11-26: the live doctrine check failed on every ' +
        'pull request after 20261126000707).'
    ).toEqual([]);
  });
});
