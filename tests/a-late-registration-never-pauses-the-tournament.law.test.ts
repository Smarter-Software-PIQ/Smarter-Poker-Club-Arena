import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rules: "i just don't want any 'un intended delays'" (Dan 2026-11-18)
 * and "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION" (2026-08-30).
 * Incident 075013fd, lane L.
 *
 * A late registration into a RUNNING event took the seat gate: the event's
 * rolling lane T(id) EXCLUSIVE plus FOR UPDATE on every table row, roster row
 * and live seat of the event. Every per-hand call of every table queued behind
 * each one (measured on production 2026-11-19 01:00-01:15 UTC: 1-7.8 s waits,
 * fold gap p99 14.3 s during horse waves against 5.1 s without). Migration
 * 20261119052513 moves the five registration doors onto the event's shared
 * change lane (the rebuy key R(id) exclusive, G and T(id) shared). The
 * behaviour is executed on real PostgreSQL by the native harness pinned below
 * (production pre-images, before and after, races with a hand settlement, a
 * rebuy and a balancing move, a new table opened inside the lane, a mixed run
 * with zero deadlocks); this file pins the shape so the exclusive path cannot
 * quietly come back.
 */
const file = '20261119052513_a_late_registration_never_pauses_the_tournament.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(
    readFileSync('scripts/ci/fixtures/late-registration-never-pauses/preimages.json', 'utf8')
  );
const harnessPath = 'scripts/ci/test-late-registration-never-pauses-the-tournament.py';
const workflowPath = '.github/workflows/late-registration-never-pauses.yml';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const DOORS = [
  'public.fn_register_horse_for_tournament(uuid,uuid,boolean)',
  'public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)',
  'public.fn_register_for_tournament(uuid,boolean)',
  'public.fn_register_for_tournament_with_ticket(uuid,uuid)',
  'public.fn_seat_late_registrant(uuid,uuid)',
];
const PROVENANCE = 'public.fn_satellite_target_player_provenance_is_immutable()';

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

const gate = migration.match(
  /CREATE FUNCTION public\.fn_ca_lock_tournament_registration_acquisition[\s\S]*?\$function\$;/
)![0];

describe('A late registration never pauses the tournament', () => {
  it('is one bounded function-only transaction, after lane R2, with no stale pin', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(
      /\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/
    );
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE|@stale-pin-ok/
    );
    // Lane R2's post-images are its preconditions: nested rolling-lane calls
    // and the F06 try accept the held change lane.
    expect(migration).toContain('must be installed first');
    expect(migration).toContain("'b76daaf8587cca4eeac91ec39e9e7ce3'");
    expect(migration).toContain("'96ce828d6019c6c18fe660222bbd9feb'");
  });

  it('every registration door takes the registration root, never the seat gate directly', () => {
    for (const door of DOORS) {
      const body = postImage(door);
      expect(body, door).not.toMatch(/fn_ca_lock_tournament_seat_acquisition\(/);
      expect(body.match(/fn_ca_lock_tournament_registration_acquisition\(/g), door).toHaveLength(1);
    }
  });

  it('the registration root joins the shared change lane and holds no field-wide row lock', () => {
    // The lane is the rebuy's: registration and rebuys serialise on R(id).
    expect(gate).toMatch(
      /PERFORM public\.fn_ca_share_tournament_lane_for_rebuy\(p_tournament_id, p_user_id\);/
    );
    expect(gate).not.toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\(\s*'ca:tournament-terminal-settlement/
    );
    expect(gate).not.toMatch(/fn_ca_lock_settlement_lane_for_tournament/);
    // One row lock, one row: the launch receipt. Never every table, roster row or seat.
    expect(gate.match(/FOR UPDATE/g)).toHaveLength(1);
    expect(gate).toMatch(/WHERE r\.tournament_id = p_tournament_id\s*FOR UPDATE;/);
    // Only a RUNNING mtt event, outside any exclusive authority, takes the
    // shared lane; everything else is the unchanged seat gate.
    expect(gate).toMatch(
      /IF v_status IS DISTINCT FROM 'RUNNING'\s*OR v_format IS NULL OR v_format NOT IN \('mtt-v1', 'mtt-v2'\)\s*OR v_exclusive THEN\s*RETURN public\.fn_ca_lock_tournament_seat_acquisition\(p_tournament_id, NULL, p_user_id\);/
    );
    expect(gate).toContain("l.mode = 'ExclusiveLock'");
    // Re-entry reuses the lane this transaction already holds.
    expect(gate).toContain(
      'IF NOT smarter_private.tournament_rebuy_lane_held(p_tournament_id, p_user_id) THEN'
    );
    // The status is re-read under the lane before anything is admitted.
    expect(gate.indexOf('fn_ca_share_tournament_lane_for_rebuy(p_tournament_id')).toBeLessThan(
      gate.indexOf("'reason', 'registration_closed'")
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_lock_tournament_registration_acquisition\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('a satellite-ticket entrant admitted late is accepted on the held lane of its own event and player', () => {
    const guard = postImage(PROVENANCE);
    expect(guard).toMatch(
      /IF TG_OP='INSERT' AND NOT COALESCE\(v_owns_acquisition_root,false\)\s*AND smarter_private\.tournament_rebuy_lane_held\(NEW\.tournament_id,NEW\.user_id\) THEN\s*v_owns_acquisition_root:=true;/
    );
    expect(guard).toContain("'completed satellite target provenance is immutable'");
  });

  it('doctrine names the registration root in rule 6 and pins the five doors in rule 7', () => {
    const doctrine = substitutions().find(
      (s) => s.signature === 'public.fn_ca_settlement_lane_doctrine()'
    )!;
    expect(doctrine.news.join('\n')).toContain(
      "'fn_ca_lock_tournament_registration_acquisition,fn_claim_tournament_bounty_elimination,fn_eliminate_tournament_player_atomic,process_tournament_rebuy'"
    );
    expect(doctrine.news.join('\n')).toContain(
      "'fn_register_for_tournament,fn_register_for_tournament_with_ticket,fn_register_horse_for_tournament,fn_register_horse_for_tournament_to_target,fn_seat_late_registrant'"
    );
    expect(doctrine.news.join('\n')).toContain("'a_late_registration_shares_its_event_lane'");
  });

  it('is proven on native PostgreSQL against the production pre-images, in a workflow', () => {
    expect(existsSync(harnessPath)).toBe(true);
    const harness = readFileSync(harnessPath, 'utf8');
    expect(harness).toContain(file);
    expect(harness).toContain('scripts/ci/fixtures/late-registration-never-pauses/preimages.json');
    for (const proof of [
      'WAITS for the registration (the defect)',
      'proceeds at once while the registration is in flight',
      'registration vs hand settlement on its destination table',
      'registration vs rebuy',
      'registration vs balancing move',
      'opens one new table inside the shared lane',
      'a chair is refused without authority',
      'takes the seat gate unchanged',
      'chips conserved',
      'entries conserved',
      '0 deadlocks',
    ]) {
      expect(harness).toContain(proof);
    }
    for (const f of fixtures.functions) expect(md5(f.definition), f.signature).toBe(f.md5);
    expect(fixtures.functions.map((f) => f.signature)).toEqual(
      expect.arrayContaining([...DOORS, PROVENANCE])
    );
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain(`python3 ${harnessPath}`);
    expect(workflow).toContain(`supabase/migrations/${file}`);
  });
});
