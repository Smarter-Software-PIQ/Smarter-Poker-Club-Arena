/**
 * A SATELLITE SEAT HELD WITH RE-ENTRIES IS IN THE BOUNDARY (2026-11-14)
 *
 * Dan, 2026-11-14: "validate the information on them ... to insure that it is
 * 100% true and accurate". Validating the Midway statements for Nov 2 - Nov 9
 * against the chip ledger found the cash side exact and the tournament side of
 * two clubs off: a satellite-won seat whose holder ALSO bought chips in the
 * same open tournament reached fn_union_pnl_boundary's general branch, which
 * held the entries less the returns and nothing for the seat. Six seats
 * (405.00) were missing from the 2026-11-02 boundary, moving 30.50 of Deep
 * Stack's and 10.00 of KINGS CLUB's ECO between two weeks.
 *
 * This pins the line that adds the seat, the refusals that keep it from being
 * guessed, and the pin move the union close needs to keep certifying.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_a_satellite_seat_held_with_re_entries_is_in_the_boundary.sql')
);
if (name.length !== 1) throw new Error('Expected One Satellite Seat With Entries Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');

describe('a satellite seat held with re-entries is in the boundary', () => {
  it('is one transaction, guarded by the preimages it changes', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("SET LOCAL lock_timeout = '1s';");
    expect(code).toContain("'5e4e878524a91518de209bc5e008db36'");
    expect(code).toContain("'8938ab5adca3670b89ab8515f087646e'");
    expect(code).toContain('SEAT_WITH_ENTRIES_BOUNDARY_PREIMAGE_CHANGED');
    expect(code).toContain('SEAT_WITH_ENTRIES_SOURCES_PREIMAGE_CHANGED');
  });

  it('the general branch adds the seat after entries less returns, for the club that funded the seat', () => {
    expect(code).toContain('c_old constant text := $old$   value:=value-COALESCE(returned,0);');
    expect(code).toContain('A SATELLITE SEAT HELD WITH RE-ENTRIES (20261114182834)');
    expect(code).toContain("IF s->>'source_satellite_id' IS NOT NULL THEN");
    // The same seat-row predicate the seat-only branch uses.
    expect(code).toContain("l.metadata->>'kind'='satellite_seat_pool_transfer'");
    expect(code).toContain("l.metadata->>'kind'='tournament_entry_ticket_admission'");
    expect(code).toContain(
      "seat_club:=public.fn_union_pnl_satellite_seat_owner((s->>'id')::uuid,(t->>'id')::uuid);"
    );
    expect(code).toContain(
      "jsonb_build_object('club_id',seat_club,'user_id',s->'user_id','amount',seat_value,"
    );
    expect(code).toContain("'basis','satellite_seat'");
  });

  it('a seat it cannot prove is refused, never guessed', () => {
    expect(code).toContain('IF seat_rows>0 THEN');
    expect(code).toContain(
      'IF seat_rows<>1 OR seat_value IS NULL OR seat_value<=0 OR seat_club IS NULL'
    );
    expect(code).toContain('OR seat_credit_total IS DISTINCT FROM COALESCE(returned,0) THEN');
    expect(code).toContain("'open_tournament_satellite_seat_with_entries_unproven'");
  });

  it('the proof source list follows the new body and no stale pin is left', () => {
    expect(code).toContain("PERFORM set_config('search_path', 'pg_catalog', true);");
    expect(code).toContain('p := replace(d, old_bound, new_bound);');
    expect(code).toContain('smarter_private.original_inventory_proof_sources_match() IS NOT TRUE');
    expect(code).toContain('SEAT_WITH_ENTRIES_LEFT_A_STALE_PIN');
    expect(sql).toMatch(/^-- @live-proof: .*original_inventory_proof_sources_match\(\) IS TRUE/m);
  });
});
