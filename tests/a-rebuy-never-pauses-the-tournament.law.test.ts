import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rule, Dan 2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
 * ACTION." Incident 075013fd, lane R.
 *
 * process_tournament_rebuy took its event's rolling lane T(id) EXCLUSIVE for
 * its whole transaction (375 ms on average, 28.7 s at most, about 21 a minute
 * on the Morning Free Buy, 2026-11-18), and every per-hand call of all 61
 * tables takes T(id) shared, so the whole event stopped for every rebuy.
 * Migration 20261118191946 moves rebuys, re-entries and add-ons onto a shared
 * rebuy lane. The behaviour is executed on real PostgreSQL 16 by the native
 * harness pinned below (production pre-images, before and after, races with a
 * balancing move and a hand settlement, a mixed run with zero deadlocks);
 * this file pins the shape so the exclusive lane cannot quietly come back.
 */
const file = '20261118191946_a_rebuy_never_pauses_the_tournament.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(readFileSync('scripts/ci/fixtures/rebuy-never-pauses/preimages.json', 'utf8'));
const harnessPath = 'scripts/ci/test-rebuy-never-pauses-the-tournament.py';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const REBUY = 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)';
const SEAT_GUARD = 'public.fn_tournament_live_seat_acquisition_requires_authority()';

/** The migration's own substitution table: signature, pre, post, olds, news. */
function substitutions() {
  const block = migration.match(/DO \$subs\$([\s\S]*?)END \$subs\$;/)![1];
  const re =
    /\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*ARRAY\[([\s\S]*?)\],\s*ARRAY\[([\s\S]*?)\]\)/g;
  const quoted = (s: string, tag: string) =>
    [...s.matchAll(new RegExp(`\\$(${tag}\\d+)\\$([\\s\\S]*?)\\$\\1\\$`, 'g'))].map((m) => m[2]);
  return [...block.matchAll(re)].map((m) => ({
    signature: m[1],
    pre: m[2],
    post: m[3],
    olds: quoted(m[4], 'o'),
    news: quoted(m[5], 'n'),
  }));
}

function postImage(signature: string) {
  const sub = substitutions().find((s) => s.signature === signature)!;
  const fixture = fixtures.functions.find((f) => f.signature === signature)!;
  expect(md5(fixture.definition)).toBe(fixture.md5);
  expect(fixture.md5).toBe(sub.pre);
  let def = fixture.definition;
  sub.olds.forEach((old, i) => {
    expect(def.split(old).length - 1).toBe(1);
    def = def.replace(old, () => sub.news[i]);
  });
  expect(md5(def)).toBe(sub.post);
  return def;
}

describe('A rebuy never pauses the tournament', () => {
  it('is one bounded function-only transaction, after lane T, with one reasoned stale pin', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(
      /\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/
    );
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    const stale = [...migration.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map(
      (m) => m[1]
    );
    expect(stale).toEqual(['21cbb3a7feaa634552aeb33541b075d2']);
    // Lane T's post-images are its preconditions: table writers take B, never G.
    expect(migration).toContain('must be installed first');
    expect(migration).toContain("'203a70a10f5398414e831d1d073334d9'");
    expect(migration).toContain("'08f84155a603076693d56f086add0b77'");
  });

  it('process_tournament_rebuy takes the exclusive tournament lane only for a bounty-event generation', () => {
    const body = postImage(REBUY);
    const exclusiveCalls = body.match(/public\.fn_ca_lock_settlement_lane_for_tournament\(/g) ?? [];
    expect(exclusiveCalls).toHaveLength(1);
    // That one call sits in the bounty / PKO / mystery branch, and every other
    // rebuy, re-entry and add-on takes the shared rebuy lane instead.
    expect(body).toMatch(
      /IF v_type<>'addon' AND EXISTS \(\s*SELECT 1 FROM public\.tournaments t\s*WHERE t\.id=p_tournament_id\s*AND \(COALESCE\(t\.is_bounty,false\) OR COALESCE\(t\.is_pko,false\)\s*OR COALESCE\(t\.is_mystery_bounty,false\)\)\) THEN\s*PERFORM public\.fn_ca_lock_settlement_lane_for_tournament\(p_tournament_id\);\s*ELSE\s*PERFORM public\.fn_ca_share_tournament_lane_for_rebuy\(p_tournament_id,p_user_id\);\s*v_lane_shared:=true;\s*END IF;/
    );
    // The field-wide seat gate is reached only off the shared lane.
    expect(body).toMatch(
      /IF v_lane_shared THEN[\s\S]*?v_gate:=public\.fn_ca_lock_tournament_rebuy_acquisition\(\s*p_tournament_id,v_table_id,p_user_id\);\s*ELSE\s*v_gate:=public\.fn_ca_lock_tournament_seat_acquisition\(\s*p_tournament_id,NULL,p_user_id\);\s*END IF;/
    );
    expect(body.match(/fn_ca_lock_tournament_seat_acquisition\(/g)).toHaveLength(1);
  });

  it('the shared rebuy lane takes T and G only shared, and its seat root no field-wide lock', () => {
    const lane = migration.match(
      /CREATE FUNCTION public\.fn_ca_share_tournament_lane_for_rebuy[\s\S]*?\$function\$;/
    )![0];
    expect(lane).not.toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\(\s*'ca:tournament-terminal-settlement:v1/
    );
    expect(lane).toMatch(
      /pg_advisory_xact_lock_shared\(\s*hashtextextended\(\s*'ca:tournament-terminal-settlement:v1:'/
    );
    expect(lane).toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\(\s*'ca:tournament-rebuy-lane:v1:'/
    );
    // R before G and T: nothing holding G, F, B or T ever waits for R.
    expect(lane.indexOf("'ca:tournament-rebuy-lane:v1:'")).toBeLessThan(
      lane.indexOf("'ca:tournament-terminal-settlement:v1'")
    );
    const gate = migration.match(
      /CREATE FUNCTION public\.fn_ca_lock_tournament_rebuy_acquisition[\s\S]*?\$function\$;/
    )![0];
    expect(gate).not.toMatch(
      /fn_ca_lock_settlement_lane_for_tournament|fn_ca_lock_tournament_seat_acquisition\(/
    );
    // Three row locks, each one row: the launch receipt, the tournament and
    // the candidate's own table. Never every table, roster row or seat.
    expect(gate.match(/^\s*FOR UPDATE;$/gm)).toHaveLength(3);
    expect(gate).toMatch(/WHERE r\.tournament_id = p_tournament_id\s*FOR UPDATE;/);
    expect(gate).toMatch(/WHERE t\.id = p_tournament_id\s*FOR UPDATE;/);
    expect(gate).toMatch(/WHERE tb\.id = p_table_id\s*FOR UPDATE;/);
    expect(gate).toContain('tournament_rebuy_lane_held(p_tournament_id, p_user_id)');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_share_tournament_lane_for_rebuy\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('a chair still needs exclusive authority, or the rebuy proof for its own player plus the table row', () => {
    const guard = postImage(SEAT_GUARD);
    expect(guard).toMatch(
      /AND smarter_private\.tournament_rebuy_lane_held\(v_tournament_id,NEW\.user_id\) THEN\s*BEGIN\s*PERFORM 1 FROM public\.tables tb WHERE tb\.id=NEW\.table_id FOR UPDATE NOWAIT;/
    );
    expect(guard).toContain("'TOURNAMENT_SEAT_ACQUISITION_REQUIRES_TERMINAL_AUTHORITY'");
    const held = migration.match(
      /CREATE FUNCTION smarter_private\.tournament_rebuy_lane_held[\s\S]*?\$function\$;/
    )![0];
    // Bound to this transaction and backed by the locks, never the marker alone.
    expect(held).toContain('txid_current()');
    expect(held).toContain('pg_catalog.pg_locks');
    expect(held).toMatch(/l\.mode = 'ExclusiveLock' THEN 'r'/);
  });

  it('is proven on native PostgreSQL against the production pre-images', () => {
    expect(existsSync(harnessPath)).toBe(true);
    const harness = readFileSync(harnessPath, 'utf8');
    expect(harness).toContain(file);
    expect(harness).toContain('scripts/ci/fixtures/rebuy-never-pauses/preimages.json');
    for (const proof of [
      'WAITS for the rebuy (the defect)',
      'proceeds at once while the rebuy is in flight',
      'rebuy vs balancing move',
      'rebuy vs hand settlement on its destination table',
      'a chair is refused without exclusive authority',
      'chips conserved',
      '0 deadlocks',
    ]) {
      expect(harness).toContain(proof);
    }
    expect(fixtures.functions.map((f) => f.signature)).toEqual(
      expect.arrayContaining([
        REBUY,
        SEAT_GUARD,
        'public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)',
      ])
    );
  });
});
