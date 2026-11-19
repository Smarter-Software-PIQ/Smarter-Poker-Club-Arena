import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rule, Dan 2026-08-30: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
 * ACTION." Incident 075013fd, lane R2.
 *
 * 20261118191946 moved rebuys onto a shared lane but left two things on the
 * event's exclusive lane T(id): a rebuy of a bounty, PKO or mystery event (its
 * old bounty is settled through authorities that each take T(id)), and every
 * bust (fn_eliminate_tournament_player_atomic, fn_claim_tournament_bounty_
 * elimination). Migration 20261119011750 puts both on the shared change lane.
 * The behaviour is executed on PostgreSQL 16 by
 * scripts/ci/test-rebuy-never-pauses-the-tournament.py; this pins the shape.
 */
const file = '20261119011750_bounty_rebuys_and_eliminations_share_the_event_lane.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(readFileSync('scripts/ci/fixtures/rebuy-never-pauses/preimages.json', 'utf8'));
const harness = readFileSync('scripts/ci/test-rebuy-never-pauses-the-tournament.py', 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

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

/** Post-image of a function whose production pre-image is in the fixture. */
function postImage(signature: string) {
  const sub = substitutions().find((s) => s.signature === signature)!;
  const fixture = fixtures.functions.find((f) => f.signature === signature)!;
  expect(md5(fixture.definition)).toBe(sub.pre);
  let def = fixture.definition;
  sub.olds.forEach((old, i) => {
    expect(def.split(old).length - 1).toBe(1);
    def = def.replace(old, () => sub.news[i]);
  });
  expect(md5(def)).toBe(sub.post);
  return def;
}

describe('Bounty rebuys and busts share the event lane', () => {
  it('is one bounded function-only transaction after 20261118191946, with one reasoned stale pin', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(
      /\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/
    );
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    expect(
      [...migration.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map((m) => m[1])
    ).toEqual(['9877846ffabee004690e6b24a3ddcee2']);
    expect(migration).toContain('20261118191946 (the shared rebuy lane) must be installed first');
  });

  it('the rolling lane helper and the F06 try take the shared change lane as already held', () => {
    const sub = substitutions();
    const lane = sub.find(
      (s) => s.signature === 'public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'
    )!;
    expect(lane.news[0]).toMatch(
      /IF v_tournament_id IS NOT NULL\s+AND smarter_private\.tournament_rebuy_lane_held\(v_tournament_id, NULL\) THEN\s+RETURN;/
    );
    const tryLane = sub.find((s) => s.signature === 'smarter_private.f06_try_lane(uuid)')!;
    expect(tryLane.news[0]).toContain(
      'NOT smarter_private.tournament_rebuy_lane_held(t,NULL) AND (NOT pg_try'
    );
  });

  it('a rebuy in every format, and both bust doors, take the shared lane and never the exclusive one', () => {
    for (const sig of [
      'public.fn_eliminate_tournament_player_atomic(uuid,uuid,integer,numeric,numeric)',
      'public.fn_claim_tournament_bounty_elimination(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)',
    ]) {
      const body = postImage(sig);
      expect(body).toContain(
        'PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,'
      );
      expect(body).not.toMatch(/fn_ca_lock_settlement_lane_for_tournament\(/);
      expect(body).not.toMatch(
        /pg_advisory_xact_lock\(\s*hashtextextended\(\s*'ca:tournament-terminal-settlement:v1/
      );
      // The busted player's table row before its roster row.
      expect(body.indexOf('FROM public.tables tb')).toBeLessThan(
        body.indexOf('SELECT * INTO v_player')
      );
    }
    const rebuy = substitutions().find((s) =>
      s.signature.startsWith('public.process_tournament_rebuy(')
    )!;
    expect(rebuy.news.join('')).toContain(
      'PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);'
    );
    expect(rebuy.news.join('')).not.toMatch(
      /fn_ca_lock_settlement_lane_for_tournament\(|fn_ca_lock_tournament_seat_acquisition\(/
    );
  });

  it("a bounty settlement takes its claimants' tables before any roster row", () => {
    const body = postImage('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)');
    const lock = body.indexOf(
      'IF smarter_private.tournament_rebuy_lane_held(p_tournament_id,p_user_id) THEN'
    );
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(body.indexOf('SELECT * INTO v_player'));
    expect(body).toMatch(
      /JOIN public\.table_seats s\s+ON s\.user_id=\(e->>'user_id'\)::uuid AND s\.left_at IS NULL/
    );
    expect(body).toMatch(/ORDER BY tb\.id\s+FOR UPDATE;/);
  });

  it('is proven natively: no pause, the race against a hand, conservation, 0 deadlocks', () => {
    expect(harness).toContain(file);
    for (const proof of [
      'before R2: a bust being recorded',
      'before R2: a bounty rebuy',
      'after R2: a bust vs a hand of its own table',
      "after R2: a bounty rebuy vs a hand of its knocker's table",
      'R2 mixed run',
      'R2 mixed bounty run',
    ]) {
      expect(harness).toContain(proof);
    }
  });
});
