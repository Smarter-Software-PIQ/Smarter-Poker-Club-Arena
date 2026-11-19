import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner ruling, 2026-11-17: "a tournament issue must always be isolated and
 * never affect other tournaments or cash games". Incident 075013fd, lane T,
 * part 2 (migration 20261118171613). After 20261118160405 a global authority
 * paused every table only while it HELD the lane; this moves the 30 functions
 * that took the global lane for one club's or one event's work onto a club
 * lane or an event lane, which fence only that club or event. The native
 * harness proves it (a club, event, cancellation or satellite lane held 10 s
 * pauses no writer outside its scope; 480-transaction workload, zero
 * deadlocks); this file pins the migration's shape.
 */
const file = '20261118171613_tournament_and_club_lanes_fence_only_their_own_tables.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const harness = readFileSync('scripts/ci/test-tournament-lane-isolation.py', 'utf8');
const workflow = readFileSync('.github/workflows/table-writer-lane-isolation.yml', 'utf8');

const callerRows = [
  ...migration.matchAll(
    /\('((?:public|smarter_private)\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', (?:\$new\$(.*?)\$new\$|NULL), '([0-9a-f]{32})'\)/g
  ),
].map((m) => ({ sig: m[1], pre: m[2], text: m[3], post: m[4] }));

const CANCELLATION_SHAPED = [
  'public.fn_execute_managed_game_command(uuid,text,uuid,text,integer,jsonb)',
  'public.fn_poker_diamond_cancel_tournament(uuid)',
  'smarter_private.f06_void_retired_mixed_custody_event(uuid,text)',
];
const CLUB_SHAPED = [
  'public.fn_retire_settled_club(uuid,text,text)',
  'public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)',
  'smarter_private.unwind_heads_up_fixture(uuid,uuid,uuid[])',
];

describe('An authority fences only its own tables', () => {
  it('is one bounded transaction that requires the first migration and declares only dead pins', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(/\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/);
    expect(migration).toContain("'ff501f74982567097241b1d90fbb4b96'");
    expect(migration).toContain("'a386f2d5adfbdc1a5ab2ee4a5bee298d'");
    const stale = [...migration.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map((m) => m[1]);
    expect(stale.sort()).toEqual(['503a9f90806bf5498ebd0b006dcc0641', '7c759bb7a639c3124de2607bdbf12577']);
    expect(migration).not.toMatch(/@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX/);
  });

  it('moves all 30 one-club or one-event callers off the global lane, each md5-pinned both ways', () => {
    const subs = callerRows.filter((r) => r.text !== undefined);
    expect(subs).toHaveLength(30);
    for (const r of subs) {
      expect(r.pre).not.toBe(r.post);
      expect(r.text).toMatch(/^PERFORM public\.fn_ca_lock_settlement_lane_for_(event|club)\(/);
      if (CLUB_SHAPED.includes(r.sig)) expect(r.text).toMatch(/_for_club\(p_club_id\);$/);
      else if (CANCELLATION_SHAPED.includes(r.sig)) expect(r.text).toMatch(/_for_event\([^)]*, true\);$/);
      else expect(r.text).toMatch(/_for_event\([^,]*\);$/);
    }
    // The heads-up fixture's pin moves to the unwind's reviewed post-image.
    const pin = callerRows.find((r) => r.sig === 'public.fn_ca_retire_heads_up_fixture(uuid,text)')!;
    expect(pin.text).toBeUndefined();
    const unwind = callerRows.find((r) => r.sig === CLUB_SHAPED[1])!;
    expect(migration).toContain(`'${unwind.pre}', '${unwind.post}')`);
    // The native harness skips only this block, so it is delimited exactly once.
    expect(migration.match(/-- @begin caller substitutions/g)).toHaveLength(1);
    expect(migration.match(/-- @end caller substitutions/g)).toHaveLength(1);
  });

  it('leaves the global lane to the two multi-event sweeps and the lane helpers', () => {
    expect(migration).toContain(`  v_global_allowed CONSTANT text[] := ARRAY[
    'fn_backpay_unfinalised_bounty_pools','fn_sweep_unsettled_tournament_rake',
    'fn_ca_lock_settlement_lane_for_finish','fn_ca_lock_settlement_lane_for_satellite_finish',
    'fn_ca_lock_settlement_lane_for_event'];`);
    expect(migration).toContain("OR r.callee = 'fn_ca_lock_settlement_lane_for_club' THEN");
  });

  it('builds the club lane in the documented order and fences cash by club', () => {
    const club = migration.slice(
      migration.indexOf('CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_club'),
      migration.indexOf('CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_event')
    );
    const order = [
      "pg_advisory_xact_lock_shared(\n    hashtextextended('ca:tournament-terminal-settlement:v1', 0))",
      "pg_advisory_xact_lock_shared(\n    hashtextextended('ca:tournament-finish-lane:v1', 0))",
      "hashtextextended('ca:tournament-finish-lane:v1:scope:' || v_scope, 0)",
      "hashtextextended('ca:club-settlement-lane:v1:' || p_club::text, 0)",
      'ORDER BY t.id::text',
    ].map((s) => club.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(club).not.toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('ca:tournament-terminal-settlement:v1',/);
    expect(migration).toContain("hashtextextended('ca:club-settlement-lane:v1:' || v_club::text, 0));");
    // No hand-path advisory statement names a club/union/pool id (fn_ca_hand_path_shared_writes).
    expect(club).not.toMatch(/pg_advisory_xact_lock\([^;]*(union|club|pool)_id/);
  });

  it('keeps cancellation strict: a club lane only for its own club, and the observer pin moves', () => {
    expect(migration).toContain("CANCELLATION_CLUB_AUTHORITY_INCOMPLETE");
    expect(migration).toContain("AND t.club_id::text=current_setting('ca.club_lane',true))");
    expect(migration).toContain("AND md5(pg_get_functiondef(p.oid))='d66f767af93b4c9e93c42bcc9472005e'");
    expect(migration).toContain("('smarter_private.cancellation_lane(uuid)', 'd66f767af93b4c9e93c42bcc9472005e')");
  });

  it('pins its exact bytes to the native PostgreSQL proof that CI runs', () => {
    const hash = createHash('sha256').update(migration).digest('hex');
    expect(harness).toContain(`require_hash2 = '${hash}'`);
    expect(workflow).toContain(`- supabase/migrations/${file}`);
    for (const witness of [
      'a script can no longer take the global lane as its own top-level statement',
      "a club lane held 10 s: another club\\'s cash hand commits at once",
      "a club lane held 10 s: another club\\'s tournament writer writes at once",
      "an event lane held 10 s: other events\\' writers and cash hands carry on at once",
      "an exclusive (cancellation) event lane held 10 s: no other event\\'s table or cash hand waits",
      'a satellite lane held 10 s: the satellite and its target wait, nothing else does',
      "inside a club lane: another club's cancellation is refused",
      'the table guard lets a hand commit update its counter while a global authority queues',
      'mixed writer/authority/finish/global transactions: zero deadlocks',
    ]) {
      expect(harness).toContain(witness);
    }
  });
});
