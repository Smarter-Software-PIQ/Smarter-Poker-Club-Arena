/**
 * LAW - A HORSE BELONGS TO ONE ASSIGNED CLUB
 *
 * Owner order 2026-11-02: Deep Stack Society 500 horses, The Felt Society 500,
 * KINGS CLUB none; one club per horse; every horse restarts at exactly 10,000;
 * the split runs only after the week's rakeback has paid; Kings Club's real
 * counts stay real and any display addition is labelled separately.
 *
 * The unit suite has no database, so this pins the migration's shape: the
 * fixed manifest and its hash, the enforcement inside the three existing
 * admission trigger bodies, the operation's preconditions and duplicate
 * protection, and the separately labelled Kings display. The behaviour was
 * executed end to end on a scratch PostgreSQL 16 (docs/changelog).
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const NAME = '20261102141229_horses_belong_to_one_assigned_club.sql';
const sql = readFileSync(join(MIGRATIONS, NAME), 'utf8');
const later = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f > NAME)
  .map((f) => [f, readFileSync(join(MIGRATIONS, f), 'utf8')] as const);

const DSS = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
const FELT = 'a0000000-0000-0000-0000-000000000001';
const KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';

describe('a horse belongs to one assigned club', () => {
  it('carries a literal manifest of exactly 500 + 500 and asserts its hash', () => {
    const rows = sql.match(/\('[0-9a-f-]{36}','[DF]'\)/g) ?? [];
    expect(rows.length).toBe(1000);
    expect(rows.filter((r) => r.endsWith("'D')")).length).toBe(500);
    expect(rows.filter((r) => r.endsWith("'F')")).length).toBe(500);
    expect(new Set(rows.map((r) => r.slice(2, 38))).size).toBe(1000);
    expect(sql).toContain('22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270');
    expect(sql).toContain('horse_club_manifest_hash_mismatch');
    expect(sql).toMatch(/CHECK \(club_id IN \('2a1132b9[^)]*'a0000000/);
  });

  it('enforces inside the three existing admission trigger bodies', () => {
    for (const fn of [
      'fn_ca_reject_automated_user_club_row',
      'fn_stamp_seat_club',
      'fn_guard_membership_lifecycle_write',
    ]) {
      // Bounded by the function's own dollar-quote, never by a byte count.
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`);
      const end = sql.indexOf('$function$;', start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const body = sql.slice(start, end);
      expect(body).toContain('HORSES BELONG TO ONE ASSIGNED CLUB');
      expect(body).toContain('fn_ca_horse_club_refusal');
    }
    // Kings never admits a horse, and an unassigned horse is admitted nowhere.
    expect(sql).toContain(`p_host = '${KINGS}'::uuid`);
    expect(sql).toContain('HORSE_HAS_NO_ASSIGNED_CLUB');
    // Union routing: a union host is admitted only when it contains the
    // assigned club, and the wallet club must be the assigned club.
    expect(sql).toContain('JOIN public.union_clubs uc ON uc.union_id = u.union_id AND uc.club_id = v_home');
    expect(sql).toContain('A Horse Is Funded Only From Its Assigned Club');
    // No trigger DDL on a hot table.
    expect(sql).not.toMatch(/CREATE TRIGGER|ALTER TABLE public\.(club_members|table_seats|tournament_players)/);
  });

  it('moves no chip before the week has paid and the board is quiet', () => {
    for (const blocker of [
      'weekly_payout_not_released',
      'weekly_payout_scopes_still_owed',
      'horse_fleet_enabled',
      'horse_live_seats',
      'horse_tournament_custody',
      'horse_cashouts',
      'horse_escrow',
      'horse_tickets',
      'horse_unreconciled_member_balances',
    ]) {
      expect(sql).toContain(blocker);
    }
    expect(sql).toContain("IF NOT (v_pre->>'ready')::boolean THEN");
    expect(sql).toContain('horse_split_mint_exceeds_authorized_cap');
    expect(sql).toContain("RETURN jsonb_build_object('replayed', true)");
    // Departures keep their records; nothing is deleted.
    expect(sql).toContain("membership_lifecycle_status = 'departed'");
    expect(sql).not.toMatch(/DELETE FROM public\.club_members/);
    // It installs inert.
    expect(sql).toContain('horse_club_split_must_install_inactive');
  });

  it('keeps Kings Club real and labels the addition separately', () => {
    expect(sql).toMatch(/UPDATE public\.club_display_member_boost\s+SET boost = 0/);
    expect(sql).toContain(`('${KINGS}', 1500, 233, 'Bonus'`);
    const card = readFileSync(join(__dirname, '..', 'src', 'components', 'club', 'ClubCardPanel.tsx'), 'utf8');
    expect(card).toContain('displayAddition');
    expect(card).toContain('Not Counted As Real Members');
  });

  it('is not redefined later without the enforcement', () => {
    for (const [f, body] of later) {
      for (const fn of ['fn_ca_reject_automated_user_club_row', 'fn_stamp_seat_club', 'fn_guard_membership_lifecycle_write']) {
        if (body.includes(`FUNCTION public.${fn}(`)) {
          expect(body, `${f} redefines ${fn}`).toContain('HORSES BELONG TO ONE ASSIGNED CLUB');
        }
      }
    }
    expect(DSS && FELT).toBeTruthy();
  });
});
