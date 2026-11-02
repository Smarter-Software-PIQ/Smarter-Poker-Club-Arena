/**
 * LAW - RETIRED HORSES LEAVE EVERY STAT, AND THE LIGHTNING PILOT CLOSES
 *
 * Owner order 2026-11-02 17:17 CT: "RETIRE THE HORSES AND RETIRE THE LIGHNING
 * PILOT". Retired horses leave every club's player statistics; the retired
 * Lightning Internal Pilot's horse memberships depart with records retained.
 * The house board function admits the pilot for that one transaction only
 * and is restored byte for byte before COMMIT.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = '20261102231943_retired_horses_and_the_lightning_pilot_retire.sql';
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', NAME), 'utf8');
const PILOT = 'e14bc9f7-736d-425f-8f2c-e78305ebac1d';

describe('retired horses and the Lightning pilot are retired', () => {
  it('drops every retired horse from every attribution view', () => {
    const views = sql.match(/CREATE OR REPLACE VIEW public\.ca_stats_\w+ AS[\s\S]*?;\n/g) ?? [];
    expect(views.length).toBe(9);
    for (const v of views) {
      expect(v).toContain('rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL');
    }
  });

  it('admits the pilot to the house board for one transaction and restores it exactly', () => {
    expect(sql).toContain(`c_pilot constant uuid := '${PILOT}'`);
    expect(sql).toContain("<> 'e9f2cebe69872f747dd84a933746f02e' THEN\n    RAISE EXCEPTION 'pilot retirement: house board function changed'");
    expect(sql).toContain("RAISE EXCEPTION 'pilot retirement: house board function not restored'");
    const swap = sql.indexOf("EXECUTE replace(v_orig, v_anchor");
    const restore = sql.indexOf('EXECUTE v_orig;');
    expect(swap).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(swap);
  });

  it('departs only horse memberships of a retired pilot that holds no value', () => {
    expect(sql).toContain("IS DISTINCT FROM 'retired' THEN\n    RAISE EXCEPTION 'pilot retirement: the pilot club is not retired'");
    expect(sql).toContain("'pilot retirement: the pilot still holds value or a seat'");
    expect(sql).toContain('AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cm.user_id AND p.is_horse IS TRUE)');
    expect(sql).toContain("membership_lifecycle_status = 'departed'");
    expect(sql).not.toMatch(/DELETE FROM|chip_balance\s*=/i);
  });
});
