/**
 * THE THIRTEEN CLUB DATA READERS STAY ROUTERS (2026-11-15)
 *
 * Owner, 2026-11-14: "The Club Data page must match the union weekly invoices
 * 1:1, starting and stopping at the same 2 AM boundary the invoices use."
 * 20261115034142 turned each Club Data reader into a router: a union club's
 * (or the union's) window from the day it reads the union basis reads
 * <reader>_union_basis (the invoice's accounting records), every other window
 * reads <reader>_chicago_basis (the reader as installed before). A later
 * migration that redefines one of the thirteen names as a plain reader would
 * silently send union clubs back to a basis the invoices do not use, so any
 * later file that creates, replaces, alters or drops one of them must route
 * it again.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const DIR = resolve(__dirname, '..', 'supabase/migrations');
const ROUTE = '20261115034142_club_data_readers_route_union_clubs_to_the_accounting_model.sql';
const READERS = [
  'ca_club_data_screen',
  'ca_club_data_snapshot_v2',
  'ca_club_game_page_core_20261006',
  'fn_ca_club_game_recent_rows',
  'fn_ca_club_games_searched',
  'fn_ca_club_games_unsearched',
  'fn_ca_club_data_hand_count',
  'fn_ca_club_cash_felt',
  'ca_club_data_player_totals',
  'ca_club_game_export_start',
  'ca_club_player_page_core_20261006',
  'ca_club_player_breakdown',
  'ca_club_player_export_start',
];

describe('the Club Data readers stay routers', () => {
  const route = readFileSync(resolve(DIR, ROUTE), 'utf8');

  it('routes all thirteen on their club and window, behind md5 pins', () => {
    for (const name of READERS) {
      expect(route).toMatch(new RegExp(`\\('${name}', 'public\\.${name}\\(`));
    }
    expect(route).toContain('fn_ca_club_data_reads_union_basis(p_club_id, p_start, p_end)');
    expect(route).toContain("RAISE EXCEPTION 'Club Data reader % preimage changed (md5 %)'");
    expect(route).toContain("RAISE EXCEPTION 'Club Data reader copy % is not the qualified text (md5 %)'");
  });

  it('no later migration redefines a reader without routing it again', () => {
    const later = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f > ROUTE)
      .sort();
    for (const file of later) {
      const sql = readFileSync(resolve(DIR, file), 'utf8');
      for (const name of READERS) {
        const touches = new RegExp(
          `(CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION|ALTER\\s+FUNCTION|DROP\\s+FUNCTION(\\s+IF\\s+EXISTS)?)\\s+(public\\.)?${name}\\s*\\(`,
          'i'
        );
        if (touches.test(sql)) {
          expect(sql, `${file} redefines ${name}`).toContain('fn_ca_club_data_reads_union_basis');
        }
      }
    }
  });
});
