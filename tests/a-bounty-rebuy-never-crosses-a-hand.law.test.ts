import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rule, Dan 2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
 * ACTION." Incident 075013fd, lane B7, on top of lane R2 (20261119011750).
 *
 * A hand commit takes the tournament row (FOR SHARE), then its table row,
 * then 'atomic-table:'<table>. On the shared lane the rebuy took that key
 * BEFORE the tournament row and deadlocked with a hand of the busted player's
 * own table (the hand was the victim in the native proof). The bust claim's
 * seat-first sync locked every table and seat of the event until the rebuy
 * committed. Migration 20261119013430 puts the key in the hand's order,
 * answers the sync before its field-wide lock inside the event's change lane
 * on a non-seat-first event, and bounds the settle's lock waits at 500 ms
 * with the retryable 55P03. Executed on PostgreSQL 16 by the native harness
 * (section B7); this file pins the shape.
 */
const file = '20261119013430_a_bounty_rebuy_never_pauses_the_tournament.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(readFileSync('scripts/ci/fixtures/rebuy-never-pauses/b7-preimages.json', 'utf8'));
const harness = readFileSync('scripts/ci/test-rebuy-never-pauses-the-tournament.py', 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const REBUY = 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)';
const SYNC = 'public.fn_sync_seat_first_player_count(uuid)';

function postImage(signature: string) {
  const block = migration.match(/DO \$subs\$([\s\S]*?)END \$subs\$;/)![1];
  const re =
    /\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*ARRAY\[([\s\S]*?)\],\s*ARRAY\[([\s\S]*?)\]\)/g;
  const quoted = (s: string, tag: string) =>
    [...s.matchAll(new RegExp(`\\$(${tag}\\d+)\\$([\\s\\S]*?)\\$\\1\\$`, 'g'))].map((m) => m[2]);
  const sub = [...block.matchAll(re)].find((m) => m[1] === signature)!;
  const fixture = fixtures.functions.find((f) => f.signature === signature)!;
  expect(md5(fixture.definition)).toBe(fixture.md5);
  expect(fixture.md5).toBe(sub[2]);
  let def = fixture.definition;
  const olds = quoted(sub[4], 'o');
  const news = quoted(sub[5], 'n');
  olds.forEach((old, i) => {
    expect(def.split(old).length - 1).toBe(1);
    def = def.replace(old, () => news[i]);
  });
  expect(md5(def)).toBe(sub[3]);
  return def;
}

describe('A bounty rebuy never crosses a hand', () => {
  it('is one bounded function-only transaction after lane R2', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    expect(migration).toContain("'b76daaf8587cca4eeac91ec39e9e7ce3'");
    expect(migration).toContain('must be installed first');
  });

  it("takes every 'atomic-table:' key after the tournament row, as a hand commit does", () => {
    const body = postImage(REBUY);
    const key = "hashtextextended('atomic-table:'";
    const first = body.indexOf(key);
    const last = body.lastIndexOf(key);
    expect(body.split(key).length - 1).toBe(2);
    // The add-on's tournament row, then its key.
    expect(first).toBeGreaterThan(body.indexOf('WHERE t.id=p_tournament_id FOR UPDATE;'));
    // The rebuy's seat root (tournament row, then the candidate's table row), then its key.
    expect(last).toBeGreaterThan(
      body.indexOf('v_gate:=public.fn_ca_lock_tournament_rebuy_acquisition(')
    );
    expect(body).not.toMatch(
      /fn_ca_lock_settlement_lane_for_tournament\(|fn_ca_lock_tournament_seat_acquisition\(/
    );
  });

  it('bounds the bounty settle at 500 ms with the retryable 55P03, and the engine retries it in place', () => {
    const body = postImage(REBUY);
    expect(body).toMatch(
      /PERFORM set_config\('lock_timeout','500ms',true\);\s*BEGIN\s*v_bounty_settlement:=\s*public\.fn_ca_settle_bounty_rebuy_generation_v1\([\s\S]*?EXCEPTION WHEN lock_not_available THEN\s*RAISE EXCEPTION 'TOURNAMENT_PURCHASE_PLAYER_BUSY: retry this same purchase request'\s*USING ERRCODE='55P03'/
    );
    const engine = readFileSync('server/src/tournament/TournamentManagerEliminations.ts', 'utf8');
    expect(engine).toContain('export function isTournamentPurchasePlayerBusy(');
    expect(engine).toMatch(/HORSE_REBUY_BUSY_RETRIES = 3;/);
    expect(engine).toMatch(
      /isTournamentPurchasePlayerBusy\(error\)[\s\S]{0,700}supabase\.rpc\('process_tournament_rebuy', request\)/
    );
  });

  it('the seat-first sync takes no field-wide lock inside the change lane of a non-seat-first event', () => {
    const body = postImage(SYNC);
    const skip = body.indexOf('smarter_private.tournament_rebuy_lane_held(p_tournament_id,NULL)');
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(body.indexOf('-- Freeze the complete table/seat set'));
    expect(body).toMatch(
      /IF NOT COALESCE\(v_seat_first,false\) AND NOT COALESCE\(v_is_spin,false\)\s*AND smarter_private\.tournament_rebuy_lane_held\(p_tournament_id,NULL\) THEN\s*RETURN NULL;/
    );
  });

  it('is proven on native PostgreSQL, the hand commit in production order', () => {
    expect(harness).toContain(file);
    for (const proof of [
      'DEADLOCK (the defect)',
      'WAITS for it (the field-wide sync lock)',
      'serialise, 0 deadlocks',
      'aborts only the purchase, retryable 55P03 PLAYER_BUSY',
      'every old head paid exactly once and every player re-seated',
    ]) {
      expect(harness).toContain(proof);
    }
    expect(harness).toContain('f"SELECT 1 FROM public.tournaments WHERE id=\'{TR}\' FOR SHARE; "');
  });
});
