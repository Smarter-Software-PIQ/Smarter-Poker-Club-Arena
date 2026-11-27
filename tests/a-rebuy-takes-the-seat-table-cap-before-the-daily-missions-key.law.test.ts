/**
 * LAW: A REBUY TAKES THE SEAT ROOT'S TABLE CAP BEFORE THE DAILY MISSIONS KEY (2026-11-26).
 *
 * At 2026-11-26 15:23:23 UTC a tournament seat acquisition deadlocked with the
 * same player's process_tournament_rebuy. Every seat root
 * (fn_ca_lock_tournament_seat_acquisition, ..._registration_acquisition,
 * ..._rebuy_acquisition) takes the two-int advisory key
 * (hashtext('table_cap'), hashtext(user)) and then fn_lock_daily_mission_user.
 * The rebuy's fast-refusal try-locks took the bigint table_cap key and then
 * 'daily-missions-user:', and only afterwards (through its own seat root) the
 * two-int key, blocking: the reverse order. Migration 20261126233144 tries the
 * two-int key between the two existing try-locks, with the same 55P03 refusal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261126233144_a_rebuy_takes_the_seat_table_cap_before_the_daily_missions_k.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const BIGINT = "pg_try_advisory_xact_lock(hashtextextended('table_cap:' || p_user_id::text, 0))";
const TWO_INT = "pg_try_advisory_xact_lock(hashtext('table_cap'), hashtext(p_user_id::text))";
const DAILY =
  "pg_try_advisory_xact_lock(hashtextextended('daily-missions-user:' || p_user_id::text, 0))";
const BUSY =
  "RAISE EXCEPTION 'TOURNAMENT_PURCHASE_PLAYER_BUSY: retry this same purchase request'\n            USING ERRCODE='55P03';";
const stripComments = (text: string) => text.replace(/--[^\n]*/g, '');

function literal(name: string): string {
  const m = sql.match(new RegExp(`${name} text := E'((?:[^']|'')*)';`));
  if (!m) throw new Error(`${name} literal missing`);
  return m[1].replace(/''/g, "'").replace(/\\n/g, '\n');
}

/** The live lines 405-413 shape, read from production on 2026-11-26. */
const LIVE_EXCERPT =
  '      IF NOT public.fn_entry_purchases_frozen() THEN\n' +
  `        IF NOT ${BIGINT} THEN\n` +
  `          ${BUSY}\n` +
  '        END IF;\n' +
  `        IF NOT ${DAILY} THEN\n` +
  `          ${BUSY}\n` +
  '        END IF;\n' +
  '        IF public.fn_ca_tournament_unit_cents(p_tournament_id)=100 THEN\n';

describe('a rebuy takes the seat root table cap before the daily missions key', () => {
  const oldText = literal('v_old');
  const newText = literal('v_new');

  it('anchors on the daily-missions try-lock, exactly once in the live shape', () => {
    expect(oldText).toBe(`        END IF;\n        IF NOT ${DAILY} THEN\n`);
    expect(LIVE_EXCERPT.split(oldText)).toHaveLength(2);
    expect(sql).toContain(
      "RAISE EXCEPTION 'process_tournament_rebuy daily-missions try-lock anchor was expected exactly once'"
    );
    expect(sql.match(/EXECUTE replace\(v_def, v_old, v_new\);/g)).toHaveLength(1);
  });

  it('applied to the live shape, tries bigint cap, then the two-int cap, then daily missions', () => {
    const post = LIVE_EXCERPT.replace(oldText, newText);
    const bigint = post.indexOf(BIGINT);
    const twoInt = post.indexOf(TWO_INT);
    const daily = post.indexOf(DAILY);
    expect(bigint).toBeGreaterThan(-1);
    expect(twoInt).toBeGreaterThan(bigint);
    expect(daily).toBeGreaterThan(twoInt);
    // The new try refuses exactly like its neighbours: same text, same SQLSTATE.
    expect(post.split(BUSY)).toHaveLength(4);
    expect(post.slice(twoInt, daily)).toContain(BUSY);
  });

  it('uses the same two-int key the seat roots take, and checks the root still takes it', () => {
    expect(TWO_INT).toContain("hashtext('table_cap'), hashtext(p_user_id::text)");
    expect(sql).toContain(
      "position('pg_advisory_xact_lock(hashtext(''table_cap''), hashtext(p_user_id::text))'"
    );
    expect(sql).toContain("'public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'");
  });

  it('never blocks: the new key is a try-lock', () => {
    const code = stripComments(newText);
    expect(code).not.toMatch(/\bpg_advisory_xact_lock\(/);
    expect(code.match(/pg_try_advisory_xact_lock\(/g)).toHaveLength(2);
  });

  it('keeps the grants, refuses a second application and touches no money or horse flag', () => {
    expect(sql).toContain("RAISE EXCEPTION 'process_tournament_rebuy grants changed'");
    expect(sql).toContain(
      "position('THE SEAT ROOT''S TABLE CAP BEFORE DAILY MISSIONS' IN v_def) > 0"
    );
    const code = stripComments(sql);
    expect(code).not.toMatch(/\bGRANT\b|\bREVOKE\b/);
    expect(code).not.toMatch(/is_horse/);
  });

  it('is one bounded transaction with a probe after the definition', async () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/@install-window/);
    expect(sql.match(/^-- @live-proof: \(SELECT /gm)).toHaveLength(1);
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs'))
        .href
    );
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('no later migration drops the two-int try-lock or moves it after daily missions', () => {
    const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const source = readFileSync(resolve(DIR, file), 'utf8');
      if (/CREATE OR REPLACE FUNCTION public\.process_tournament_rebuy\s*\(/i.test(source)) {
        const code = stripComments(source);
        const twoInt = code.indexOf(TWO_INT);
        const daily = code.indexOf(DAILY);
        if (daily >= 0) {
          expect(twoInt, `${file} drops the two-int table cap try-lock`).toBeGreaterThan(-1);
          expect(twoInt, `${file} tries daily missions before the two-int cap`).toBeLessThan(daily);
        }
      }
    }
  });
});
