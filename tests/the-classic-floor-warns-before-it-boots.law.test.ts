/**
 * THE CLASSIC FLOOR JUDGES THIRTY DEALT HANDS, AND WARNS BEFORE IT BOOTS
 * (Dan, owner ruling 2026-11-10)
 *
 * Dan: "FOR ALL CLASSIC GAMES THAT ARE .50/1.00 OR HIGHER, YOU MUST ADD A NEW
 * 20% VPIP ON THOSE GAMES, OR THE PLAYER GETS BOOTED", then: humans and
 * horses, a rolling thirty dealt hands with a thirty-hand minimum, per-variant
 * floors, and warn-then-boot with a safe stack cashout. Action and Madness
 * unchanged.
 *
 * Every pin below is a way this could regress into something Dan did not ask
 * for. The behavioural proof - exactly 30, the threshold boundary, warning
 * recovery, grace expiry, reconnects, concurrent eviction, forced blinds, and
 * Action/Madness isolation - runs against a real Postgres in
 * `scripts/ci/test-classic-vpip-floor.sh`, because these are SQL rules and a
 * string match cannot execute one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const MIG = read(
  'supabase/migrations/20261111003710_the_classic_floor_judges_thirty_dealt_hands_and_warns_before.sql'
);
const NIT = read('server/src/services/supabase/nitGame.ts');
const BASE = read('server/src/engine/ServerTableEngineBase.ts');

describe('the Classic VPIP floor', () => {
  it('is one transaction, as the production DDL policy requires', () => {
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
    expect(MIG.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIG.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('keeps the floors in a config table so a value needs no deploy', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.ca_classic_vpip_floors/);
    // Dan's NLH value, never lowered to accommodate the current horse fleet.
    expect(MIG).toMatch(/\('nlh',\s*1,\s*20,\s*30,\s*10,/);
    // Every supported Classic variant carries a row; none is left exempt.
    for (const v of [
      'nlh',
      'plo4',
      'plo5',
      'plo6',
      'plo8',
      'flo8',
      'flh',
      'short_deck',
      'pineapple',
    ]) {
      expect(MIG, `${v} has no floor row`).toContain(`('${v}',`);
    }
  });

  it('judges a rolling thirty with a thirty-hand minimum', () => {
    // The sample minimum and the window are the same number, so a seat with
    // fewer than thirty dealt hands cannot be judged at all.
    expect(MIG).toMatch(/\('nlh',\s*1,\s*20,\s*30,/);
    expect(MIG).toMatch(
      /LIMIT CASE WHEN COALESCE\(p_rolling, false\) THEN GREATEST\(p_window, 1\) ELSE NULL END/
    );
    expect(MIG).toMatch(/v_table_hands >= v_pol\.window_hands AND v_table_vpip < v_pol\.floor_pct/);
  });

  it('gives every reader and the enforcement the one same sample', () => {
    // fn_nit_sample is the single definition. If a reader grew its own copy of
    // the window, a player could be shown one number and judged on another.
    const callers = MIG.match(/public\.fn_nit_sample\(/g) ?? [];
    expect(callers.length).toBeGreaterThanOrEqual(4);
    for (const fn of ['fn_nit_check', 'fn_nit_status', 'fn_cash_vpip_status']) {
      const body = MIG.slice(MIG.indexOf(`FUNCTION public.${fn}(`));
      expect(body.slice(0, 4000), `${fn} does not use the shared sample`).toMatch(
        /public\.fn_nit_sample\(/
      );
    }
  });

  it('warns before it boots, and counts grace in dealt hands', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.ca_nit_warnings/);
    // Grace is hands, never wall clock: the hand boundary is the only clock
    // this path has.
    expect(MIG).toMatch(/fn_nit_hands_since\(/);
    expect(MIG).toMatch(/IF v_done < v_warn_gr THEN/);
    // A first lapse returns nothing: a warning costs no seat.
    expect(MIG).toMatch(/-- A warning costs no seat, so nothing is returned for it\./);
    // Recovery clears, and the next lapse takes a fresh full grace.
    expect(MIG).toMatch(/cleared_reason = 'recovered'/);
  });

  it('cannot double-warn or double-boot one lapse', () => {
    expect(MIG).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ca_nit_warnings_one_open_per_sitting/);
    expect(MIG).toMatch(/WHERE cleared_at IS NULL;/);
    // The closing UPDATE's own row count is the race guard.
    expect(MIG).toMatch(
      /SET cleared_at = now\(\), cleared_reason = 'evicted'\s*\n\s*WHERE id = v_warn_id AND cleared_at IS NULL;/
    );
    expect(MIG).toMatch(/IF NOT FOUND THEN\s*\n\s*CONTINUE;\s*--\s*another boundary took it first/);
  });

  it('leaves Action and Madness exactly as they are', () => {
    // vpip_rolling and vpip_grace_hands are written ONLY inside the Classic
    // branch, so a Madness snapshot has neither and reads false / zero.
    const classicBranch = MIG.slice(MIG.indexOf("IF NEW.template_name = 'classic' THEN"));
    expect(classicBranch).toMatch(/'vpip_rolling',\s*true/);
    expect(classicBranch).toMatch(/'vpip_grace_hands',\s*v_grace/);
    expect(MIG).toMatch(/COALESCE\(\(g\.ruleset_snapshot->>'vpip_rolling'\)::boolean, false\)/);
    // Grace zero means boot on the spot, which is today's behaviour.
    expect(MIG).toMatch(/IF v_pol\.grace_hands <= 0 THEN/);
  });

  it('never lowers a stronger floor that is already in force', () => {
    expect(MIG).toMatch(/'vpip_floor', GREATEST\(/);
  });

  it('never reaches back over hands played before the floor existed', () => {
    expect(MIG).toMatch(/'vpip_floor_since'/);
  });

  it('restores the grants a required DROP takes with it', () => {
    // fn_nit_status gains columns, so CREATE OR REPLACE is refused and the
    // function must be dropped. A DROP takes the ACL, so it is put back.
    expect(MIG).toMatch(/DROP FUNCTION IF EXISTS public\.fn_nit_status\(uuid\);/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.fn_nit_status\(uuid\) FROM PUBLIC;/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_nit_status\(uuid\) TO service_role;/);
  });

  it('reads no horse identity anywhere in the rule (CLAUDE.md 10.5)', () => {
    expect(MIG).not.toMatch(/is_horse/);
    expect(MIG).toMatch(/HORSES ARE PLAYERS \(Dan 2026-08-27\)\. Humans and horses, one rule\./);
  });

  it('builds no cron, watcher, sweep or repair path (CLAUDE.md 10.12)', () => {
    expect(MIG).not.toMatch(/cron\.(schedule|job)/);
    expect(MIG).not.toMatch(/fn_\w*(repair|backpay|redrive|sweep|catchup|heal)\w*/);
  });

  it('is enforced from the dealing loop, and fails open', () => {
    expect(NIT).toMatch(/export async function collectNitEnforce/);
    expect(NIT).toMatch(/supabase\.rpc\('fn_nit_enforce', \{ p_table_id: tableId \}\)/);
    // A stats call that cannot answer must never remove a player.
    const enforce = NIT.slice(NIT.indexOf('export async function collectNitEnforce'));
    expect(enforce.match(/return \[\];/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(BASE).toMatch(/const nits = await collectNitEnforce\(this\.tableId\);/);
    // Still gated on the column, so no round trip on a table without the rule.
    expect(BASE).toMatch(/this\.tableInfo\?\.nit_game === true/);
  });

  it('still stands a seat up only at a hand boundary, through one cashout', () => {
    expect(BASE).toMatch(/leaveMode: 'vpip_evicted' as const/);
    expect(BASE).toMatch(/mid_hand: false/);
    expect(BASE).toMatch(/reason: awayBlindEvict/);
  });

  it('hands the brain the floor and its own judged figure', () => {
    // The brain reads the SAME function the eviction reads, so a Classic
    // table's rolling thirty reaches the horse automatically.
    expect(NIT).toMatch(/rolling: row\.rolling === true/);
    expect(NIT).toMatch(/warned: row\.warned === true/);
    expect(MIG).toMatch(/FUNCTION public\.fn_nit_status\(p_table_id uuid\)/);
  });
});
