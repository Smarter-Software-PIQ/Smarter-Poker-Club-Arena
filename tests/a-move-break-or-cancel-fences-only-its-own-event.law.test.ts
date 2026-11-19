import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rulings: "a tournament issue must always be isolated and never affect
 * other tournaments or cash games" (2026-11-17), "I don't want any unintended
 * delays". Incident 075013fd, lane E2.
 *
 * A balancing move and every step of a table break took the event's rolling
 * lane, T(id) exclusive, so every table of the event stopped for them (the
 * rare 5-17 s gaps). The entry close, the break scan and the bounty sweep did
 * the same, and a single event's cancel took the platform lane (G and B
 * exclusive), stopping every table and every cash hand. Migration
 * 20261119053909 scopes each one to its own event and the tables it touches.
 * The behaviour is executed on PostgreSQL 16 by
 * scripts/ci/test-rebuy-never-pauses-the-tournament.py (section LANE E2);
 * this pins the shape.
 */
const file = '20261119053909_a_move_break_or_cancel_fences_only_its_own_event.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(readFileSync('scripts/ci/fixtures/event-scoped-field-lane/preimages.json', 'utf8'));
const harness = readFileSync('scripts/ci/test-rebuy-never-pauses-the-tournament.py', 'utf8');
const workflow = readFileSync('.github/workflows/tournament-event-lane.yml', 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Each substitution row: its signature, pins and its own $oN$ / $nN$ texts. */
function substitutions() {
  const block = migration.match(/DO \$subs\$([\s\S]*?)END \$subs\$;/)![1];
  const heads = [
    ...block.matchAll(
      /\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*ARRAY\[/g
    ),
  ];
  return heads.map((m, i) => {
    const seg = block.slice(
      m.index! + m[0].length,
      i + 1 < heads.length ? heads[i + 1].index : undefined
    );
    const quoted = (tag: string) =>
      [...seg.matchAll(new RegExp(`\\$(${tag}\\d+)\\$([\\s\\S]*?)\\$\\1\\$`, 'g'))].map(
        (q) => q[2]
      );
    return { signature: m[1], pre: m[2], post: m[3], olds: quoted('o'), news: quoted('n') };
  });
}

/** Post-image of a function whose production pre-image is in the fixture. */
function postImage(signature: string) {
  const sub = substitutions().find((s) => s.signature === signature)!;
  const fixture = fixtures.functions.find((f) => f.signature === signature)!;
  expect(md5(fixture.definition)).toBe(sub.pre);
  expect(fixture.md5).toBe(sub.pre);
  let def = fixture.definition;
  sub.olds.forEach((old, i) => {
    expect(def.split(old).length - 1).toBe(1);
    def = def.replace(old, () => sub.news[i]);
  });
  expect(md5(def)).toBe(sub.post);
  return def;
}

const LANE = 'public.fn_ca_share_tournament_lane_for_tables(';
const ROLLING = /fn_ca_lock_settlement_lane_for_tournament\(/;
const EXCLUSIVE_T =
  /pg_(try_)?advisory_xact_lock\(\s*hashtextextended\(\s*'ca:tournament-terminal-settlement:v1/;

describe('A move, a break, the entry close, a bounty sweep and a cancel fence only their own event', () => {
  it('is one bounded function-only transaction after lane R2, with three reasoned stale pins', () => {
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
    ).toEqual([
      '81512d0707a7a8a8c334234838974019',
      'a09b607ee2fa1471db815a9fc8a30b97',
      'dae9d5b5f71a68362f202dfdf89c8fae',
    ]);
    expect(migration).toContain('20261119011750 (lane R2) must be installed first');
    expect(migration).not.toContain('@@');
    expect(substitutions()).toHaveLength(12);
  });

  it('the event-and-tables lane takes T(id) only shared, R(id) exclusive, then the named tables in id order', () => {
    const create = migration.match(
      /CREATE FUNCTION public\.fn_ca_share_tournament_lane_for_tables\([\s\S]*?\n\$function\$;/
    )![0];
    expect(create).toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\('ca:tournament-rebuy-lane:v1:' \|\| p_tournament_id::text, 0\)\)/
    );
    expect(create).toMatch(
      /pg_advisory_xact_lock_shared\(\s*hashtextextended\('ca:tournament-terminal-settlement:v1:' \|\| p_tournament_id::text, 0\)\)/
    );
    expect(create).not.toMatch(EXCLUSIVE_T);
    expect(create).toMatch(
      /WHERE tb\.id = ANY \(p_table_ids\) AND tb\.tournament_id = p_tournament_id\s+ORDER BY tb\.id\s+FOR UPDATE;/
    );
    // A hand commit's order and a live chair's launch-proof order: receipt,
    // event row, then the tables - never an upgrade behind a waiting hand.
    const receipt = create.indexOf('FROM public.tournament_launch_receipts r');
    const event = create.indexOf(
      'FROM public.tournaments t WHERE t.id = p_tournament_id FOR UPDATE;'
    );
    const tables = create.indexOf('FROM public.tables tb');
    expect(receipt).toBeGreaterThan(0);
    expect(receipt).toBeLessThan(event);
    expect(event).toBeLessThan(tables);
    // The proof the guards already accept: the shared change lane's marker.
    expect(create).toContain("PERFORM set_config('ca.tournament_rebuy_lane',");
    expect(create).toContain('EXCEPTION WHEN lock_not_available THEN');
  });

  it('a move takes the lane and its two tables before any row, never the rolling lane', () => {
    const body = postImage(
      'public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'
    );
    expect(body).toContain(
      `PERFORM ${LANE}\n    p_tournament_id,p_user_id,ARRAY[p_source_table_id,p_destination_table_id]);`
    );
    expect(body).not.toMatch(ROLLING);
    expect(body.indexOf(LANE)).toBeLessThan(
      body.indexOf('SELECT * INTO v_t FROM public.tournaments t')
    );
    expect(body.indexOf(LANE)).toBeLessThan(
      body.indexOf('SELECT * INTO v_tp FROM public.tournament_players')
    );
  });

  it('every break step takes the lane and its source and destination tables before the roster rows', () => {
    for (const sig of [
      'smarter_private.f06_lock_break(uuid,uuid,uuid,uuid)',
      'public.fn_f06_begin_break(uuid,uuid,uuid,jsonb)',
      'public.fn_f06_request_park(uuid,uuid,uuid,uuid,bigint,uuid)',
    ]) {
      const body = postImage(sig);
      expect(body).not.toMatch(ROLLING);
      expect(body.lastIndexOf(LANE)).toBeLessThan(
        body.indexOf('PERFORM smarter_private.f06_prefix(')
      );
    }
    // A member's live chair only: a chair it left is a row of an untouched table.
    const prefix = postImage('smarter_private.f06_prefix(uuid,uuid,uuid[],uuid[])');
    expect(prefix).toContain(
      'WHERE tb.tournament_id=t AND (s.table_id=ANY(ids) OR (s.user_id=ANY(users) AND s.left_at IS NULL)) ORDER BY s.id FOR UPDATE OF s;'
    );
    const scan = postImage('public.fn_f06_discover_breaks(uuid,uuid,bigint,integer)');
    expect(scan).not.toMatch(
      /f06_prefix\(|fn_ca_lock_settlement_lane_|fn_ca_share_tournament_lane_/
    );
    expect(scan).toContain(
      'PERFORM smarter_private.f06_authority(p_tournament_id,p_lease_generation);'
    );
  });

  it('the entry close, the bounty sweep and a collection share the lane; payers lock claimant tables first', () => {
    const close = postImage('public.fn_close_tournament_entry_window(uuid,text)');
    expect(close).toContain(`PERFORM ${LANE}p_tournament_id,NULL,NULL);`);
    expect(close).not.toMatch(ROLLING);
    const sweep = postImage('public.fn_sweep_pending_tournament_bounties(uuid,integer)');
    expect(sweep).toContain(`IF ${LANE}candidate.tournament_id,NULL,NULL,true) THEN`);
    expect(sweep).not.toMatch(EXCLUSIVE_T);
    expect(
      sweep.indexOf('smarter_private.tournament_bounty_claimant_tables(v_scope,NULL,NULL)')
    ).toBeLessThan(
      sweep.indexOf(
        'PERFORM 1 FROM public.tournaments t WHERE t.id=candidate.tournament_id FOR UPDATE;'
      )
    );
    const collect = postImage('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)');
    expect(collect).not.toMatch(ROLLING);
    expect(collect.indexOf('smarter_private.tournament_bounty_claimant_tables(')).toBeLessThan(
      collect.indexOf('PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;')
    );
  });

  it("one event's cancel takes that event's finish lane; only a several-event request keeps the platform try", () => {
    const lane = postImage('smarter_private.cancellation_lane(uuid)');
    expect(lane).toContain(
      'PERFORM public.fn_ca_lock_settlement_lane_for_finish(p_tournament_id);'
    );
    expect(lane.indexOf('fn_ca_lock_settlement_lane_for_finish(p_tournament_id)')).toBeLessThan(
      lane.indexOf('IF NOT pg_try_advisory_xact_lock(g) THEN')
    );
    expect(lane).toMatch(
      /OR t\.satellite_target_id IS NOT NULL OR t\.satellite_target IS NOT NULL\)/
    );
    const abort = postImage('public.fn_ca_request_tournament_abort(uuid,uuid[],text)');
    expect(abort).toContain('PERFORM smarter_private.cancellation_lane_for_events(ids);');
    expect(abort).not.toContain('smarter_private.cancellation_lane(');
    const events = migration.match(
      /CREATE FUNCTION smarter_private\.cancellation_lane_for_events\([\s\S]*?\n\$function\$;/
    )![0];
    expect(events).toMatch(
      /IF cardinality\(p_tournament_ids\) = 1 THEN\s+PERFORM smarter_private\.cancellation_lane\(p_tournament_ids\[1\]\);/
    );
  });

  it('doctrine rule 8 names the callers and moves rule 2 pin to the new cancellation lane', () => {
    const doctrine = postImage('public.fn_ca_settlement_lane_doctrine()');
    const cancel = substitutions().find(
      (s) => s.signature === 'smarter_private.cancellation_lane(uuid)'
    )!;
    expect(doctrine).toContain(`AND md5(pg_get_functiondef(p.oid))='${cancel.post}'`);
    expect(doctrine).toContain("'an_event_change_fences_only_its_own_tables'");
    expect(doctrine).toContain(
      "'f06_lock_break,fn_close_tournament_entry_window,fn_collect_bounty,fn_f06_begin_break,'\n       'fn_f06_request_park,fn_move_tournament_player,fn_sweep_pending_tournament_bounties'"
    );
  });

  it('is proven natively and the proof runs in its own workflow', () => {
    expect(harness).toContain(file);
    for (const proof of [
      'before E2: a balancing move',
      'before E2: a break parking its table',
      'before E2: the break scan',
      'before E2: the entry-window close',
      'before E2: a bounty sweep',
      'cancel takes the platform lane (it completes)',
      'after E2: a move vs a hand of its',
      'after E2: a break move vs a hand of its destination table',
      'a hand commit on an untouched table waits only for the event row',
      "after E2: a sweep vs a hand of its knocker's table",
      'proceeds at once while another event is cancelled',
      'E2 mixed run',
      'chips conserved',
    ]) {
      expect(harness).toContain(proof);
    }
    expect(workflow).toContain('scripts/ci/test-rebuy-never-pauses-the-tournament.py');
    expect(workflow).toContain(`supabase/migrations/${file}`);
  });
});
