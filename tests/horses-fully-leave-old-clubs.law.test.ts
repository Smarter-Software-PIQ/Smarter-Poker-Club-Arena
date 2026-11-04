/**
 * LAW - HORSES FULLY LEAVE THEIR OLD CLUBS AND TAKE THEIR STATS
 *
 * Owner order 2026-11-02 15:46 CT: "MAKE SURE ANY AND ALL HORSES ARE FULLY
 * REMOVED, THAT ALL OF THEIR PLAYER STATS ARE REMOVED AND TRANSFERED TO THERE
 * NEW CLUB".
 *
 * The split departs a horse's old membership at once (records retained); a
 * later prize on that record returns to its club bank once, after every event
 * it is in has finished. Statistics follow every canonical horse out of every
 * split club it does not belong to; no rollup, fact or ledger row is rewritten.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = '20261102215504_horses_fully_leave_old_clubs_and_take_their_stats.sql';
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', NAME), 'utf8');
const KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
const DSS = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
const FELT = 'a0000000-0000-0000-0000-000000000001';

describe('horses fully leave their old clubs', () => {
  it('departs the old membership without waiting for open entries', () => {
    expect(sql).toContain("['public.fn_ca_horse_club_split_execute(uuid,integer)'");
    expect(sql).toContain('CONTINUE WHEN EXISTS (SELECT 1 FROM public.tournament_players tp');
    expect(sql).toContain('an edit did not land');
  });

  it('returns a later prize once, only after every event on the record has finished', () => {
    const start = sql.indexOf('CREATE FUNCTION public.fn_ca_horse_club_split_late_claims');
    const body = sql.slice(start, sql.indexOf('$fn$;', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("fn_ca_horse_split_wallet_leg(p_operation, 'late_wallet_claim'");
    expect(body).toContain("l.kind = 'late_wallet_claim'");
    expect(body).toContain("NOT IN ('COMPLETED', 'CANCELLED')");
    expect(body).toContain('fn_caller_is_engine() IS NOT TRUE');
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_ca_horse_club_split_late_claims\(uuid, integer\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(sql.indexOf("('fn_ca_horse_club_split_late_claims', 'approved'")).toBeLessThan(start);
  });

  it('moves every canonical horse out of every split club it does not belong to', () => {
    const views = sql.match(/CREATE OR REPLACE VIEW public\.ca_stats_\w+ AS[\s\S]*?;\n/g) ?? [];
    expect(views.length).toBe(9);
    for (const v of views) {
      expect(v).toContain(`r.club_id <> '${KINGS}'::uuid OR NOT EXISTS`);
      expect(v).toContain(`r.club_id <> '${DSS}'::uuid OR NOT EXISTS`);
      expect(v).toContain(`r.club_id <> '${FELT}'::uuid OR NOT EXISTS`);
    }
    for (const v of views.filter((x) => !x.includes('_real AS'))) {
      expect(v).toContain('JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id');
    }
  });

  it('never rewrites a rollup, fact or ledger row', () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+public\.(?!ca_money_rpc_registry)/i);
  });
});
