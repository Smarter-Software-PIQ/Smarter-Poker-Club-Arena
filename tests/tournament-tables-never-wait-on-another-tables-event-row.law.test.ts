import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * Incident 075013fd, lane E4: tournament tables never wait on another table's
 * event row.
 *
 * Hand commits (fn_ca_commit_hand_settlement_exact_before_obligations and
 * fn_ca_commit_hand_settlement_before_lease_generation) took public.tournaments
 * FOR SHARE while shared-change-lane writers (moves, breaks, rebuys, add-ons,
 * busts, bounty sweeps/collections, entry close, launch-proof parent locks)
 * took public.tournaments FOR UPDATE. In PostgreSQL, FOR SHARE conflicts with
 * both FOR UPDATE and FOR NO KEY UPDATE, so a hand commit at Table B waited for
 * a move/break/rebuy/bust at Table A.
 *
 * Migration 20261119181500 downgrades hand commits to FOR KEY SHARE and
 * shared-change-lane writers to FOR NO KEY UPDATE on public.tournaments, and
 * pins this invariant in fn_ca_settlement_lane_doctrine() (rule 9).
 * Native PostgreSQL proof: scripts/ci/test-rebuy-never-pauses-the-tournament.py
 * (section LANE E4).
 */
const file = '20261119181500_tournament_tables_never_wait_on_another_tables_event_row.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const harness = readFileSync('scripts/ci/test-rebuy-never-pauses-the-tournament.py', 'utf8');

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

describe('Tournament tables never wait on another table event row (lane E4)', () => {
  it('is one bounded function-only transaction after E2 and E3, with reasoned stale pins and live proof', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toMatch(
      /\nBEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/
    );
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    expect(migration).toContain('-- @live-proof:');
    expect(
      [...migration.matchAll(/^--\s*@stale-pin-ok:\s*([0-9a-f]{32})\s+\S/gm)].map((m) => m[1])
    ).toEqual([
      'c555fb7b83c889312995bc0038c1b275',
      'b49192e78f472d7a931bcf20de46a702',
      '5ae262f9a0cffeb1908172c756ca5bf8',
    ]);
    expect(migration).toContain(
      '20261119053909 (lane E2) and 20261119054539 (lane E3) must be installed first'
    );
    expect(substitutions()).toHaveLength(18);
    expect(migration).toContain('DO $hand_before_lease$');
    expect(migration).toContain('DO $rebuy_addon$');
    expect(migration).toContain('process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)');
  });

  it('downgrades both hand commit doors from FOR SHARE to FOR KEY SHARE on public.tournaments', () => {
    const subs = substitutions();
    const exact = subs.find(
      (x) =>
        x.signature ===
        'public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)'
    )!;
    expect(exact).toBeDefined();
    expect(exact.olds.join('\n')).toContain('FOR SHARE;');
    expect(exact.news.join('\n')).toContain('FOR KEY SHARE;');
    expect(exact.news.join('\n')).not.toMatch(/\bFOR SHARE;/);

    const beforeLease = migration.match(/DO \$hand_before_lease\$([\s\S]*?)END \$hand_before_lease\$;/)![1];
    expect(beforeLease).toContain('PERFORM 1 FROM public.tournaments t WHERE t.id=v_tournament_id FOR SHARE;');
    expect(beforeLease).toContain('PERFORM 1 FROM public.tournaments t WHERE t.id=v_tournament_id FOR KEY SHARE;');
  });

  it('downgrades all 16 shared-change-lane writers from FOR UPDATE to FOR NO KEY UPDATE on public.tournaments', () => {
    const subs = substitutions();
    const expectedSharedWriters = [
      'public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)',
      'public.fn_lock_tournament_launch_proof_parents(uuid[])',
      'public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)',
      'public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)',
      'public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)',
      'public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)',
      'smarter_private.f06_prefix(uuid,uuid,uuid[],uuid[])',
      'public.fn_close_tournament_entry_window(uuid,text)',
      'public.fn_sweep_pending_tournament_bounties(uuid,integer)',
      'public.fn_collect_bounty(uuid,uuid,uuid,jsonb)',
      'public.fn_eliminate_tournament_player_atomic(uuid,uuid,integer,numeric,numeric)',
      'public.fn_eliminate_player_legacy_candidate_20260907(uuid,uuid,integer,numeric,numeric)',
      'public.fn_claim_tournament_bounty_elimination(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)',
      'public.fn_ca_open_tournament_seat_exit_authority(uuid,text,uuid)',
      'public.fn_close_empty_tournament_table(uuid,uuid,uuid)',
      'public.fn_sync_seat_first_player_count(uuid)',
    ];
    for (const sig of expectedSharedWriters) {
      const s = subs.find((x) => x.signature === sig)!;
      expect(s, `missing substitution for ${sig}`).toBeDefined();
      expect(s.olds.join('\n')).toContain('FOR UPDATE;');
      expect(s.news.join('\n')).toContain('FOR NO KEY UPDATE;');
      expect(s.news.join('\n')).not.toContain('FOR UPDATE;');
    }
  });

  it('adds doctrine rule 9 and is proven natively in test-rebuy-never-pauses-the-tournament.py', () => {
    const doc = substitutions().find((s) => s.signature === 'public.fn_ca_settlement_lane_doctrine()')!;
    expect(doc).toBeDefined();
    expect(doc.news[0]).toContain('shared_lane_and_hand_commit_never_contend_on_event_row');
    expect(harness).toContain(file);
    expect(harness).toContain('LANE E4');
    expect(harness).toContain('FOR KEY SHARE');
  });
});
