/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW - A CASHOUT TO YOUR OWN AGENT IS NOT A CHIP DUMP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * fn_union_integrity_sweep kept the union money_integrity incident escalated
 * from 2026-11-16 on "direct chip transfers" that were all a player cashing out
 * through the club's cashier or the agent credit route: cashout_request_escrow
 * plus cashout_approved for ONE cashout (counted twice, "146.46 in 2
 * transfers" for a 73.23 cashout), an owner approving a cashout as cashier, an
 * agent claiming credit back. The sweep also had no close path, so 14 alerts
 * sat open, the oldest from 2026-10-23.
 *
 * Migration 20261118165323:
 *   1. fn_union_transfer_counts_as_dump(chip_transactions) is the ONE
 *      definition of a player-to-player dump: the cashier documents are the
 *      cashout itself, and a movement to the sender's own agent (club_members
 *      or the cashier's assigned agent) is the agent route.
 *   2. The sweep's direct-transfer read uses that definition.
 *   3. An open sweep alert whose only signals are direct transfers closes once
 *      its own window, re-read through the same definition, holds no dump. An
 *      alert naming a winning roster or a co-seating pair stays open: that is a
 *      review item for a person.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus, migrationNames, migrationText } from './helpers/migrationCorpus';

const NAME = migrationNames()
  .filter((n) => n.endsWith('_a_cashout_to_your_own_agent_is_not_a_chip_dump.sql'))
  .at(-1);
if (!NAME) throw new Error('the union transfer definition migration is missing');
const MIG = migrationText(NAME);
const VERSION = NAME.slice(0, 14);

const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`window ${a} .. ${b} not found`);
  return s.slice(i, j);
};
const HELPER = between(
  MIG,
  'CREATE OR REPLACE FUNCTION public.fn_union_transfer_counts_as_dump(',
  '$f$;'
);

describe('a cashout to your own agent is not a chip dump', () => {
  it('pins the sweep by preimage and postimage', () => {
    expect(MIG).toContain(
      "'public.fn_union_integrity_sweep(uuid,integer)',\n  '93765162c4d5e216947137b27862446f', '5405e7e915005d18df43dcc8056f3eb0'"
    );
    expect(MIG).toContain('already the postimage, nothing to do');
  });

  it('the cashier documents are the cashout itself, never a transfer', () => {
    for (const t of [
      "'cashout'",
      "'cashout_request_escrow'",
      "'cashout_approved'",
      "'cashout_denied'",
    ]) {
      expect(HELPER).toContain(t);
    }
  });

  it("a movement to the sender's own agent is the agent route, never a dump", () => {
    expect(HELPER).toMatch(
      /m\.user_id = p_ct\.from_user_id AND m\.club_id = p_ct\.club_id\s+AND m\.agent_id = p_ct\.to_user_id/
    );
    expect(HELPER).toContain(
      "(p_ct.metadata->>'assigned_agent_id') IS DISTINCT FROM p_ct.to_user_id::text"
    );
  });

  it('a transfer between unrelated players still counts', () => {
    expect(HELPER).not.toContain("'peer_transfer'");
  });

  it('the sweep reads the one definition, and the old inline deny-list is gone from it', () => {
    const n1 = between(MIG, '$n1$', '$n1$,');
    expect(n1.replace('$n1$', '').trim()).toBe('AND public.fn_union_transfer_counts_as_dump(ct)');
    const o1 = between(MIG, '$o1$', '$o1$,');
    expect(o1).toContain("ct.transaction_type NOT IN ('agent_to_player_transfer'");
  });

  it('closes only a transfer-only alert, and only on a re-measurement through the same definition', () => {
    const n2 = between(MIG, '$n2$', '$n2$]');
    expect(n2).toContain('A MISFIRE CLOSES ON A RE-MEASUREMENT');
    expect(n2).toContain(
      "jsonb_array_length(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) = 0"
    );
    expect(n2).toContain("jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0");
    expect(n2).toContain('AND ct.created_at <= a.created_at');
    expect(n2).toContain('AND public.fn_union_transfer_counts_as_dump(ct)');
    expect(n2).toMatch(/resolution = 'verified: re-measured over its own window/);
  });

  it('closes the helper to browser roles', () => {
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_union_transfer_counts_as_dump(public.chip_transactions) FROM PUBLIC, anon, authenticated;'
    );
    expect(HELPER).not.toMatch(/SECURITY DEFINER/);
  });

  it('no later migration redefines the sweep without the one definition and the re-measured close', () => {
    for (const m of migrationCorpus()) {
      if (m.name.slice(0, 14) <= VERSION) continue;
      if (/FUNCTION\s+public\.fn_union_integrity_sweep\s*\(/i.test(m.sql)) {
        expect(m.sql, m.name).toContain('fn_union_transfer_counts_as_dump(ct)');
        expect(m.sql, m.name).toContain('A MISFIRE CLOSES ON A RE-MEASUREMENT');
      }
      if (/FUNCTION\s+public\.fn_union_transfer_counts_as_dump\s*\(/i.test(m.sql)) {
        expect(m.sql, m.name).toContain("'cashout_approved'");
        expect(m.sql, m.name).toContain('m.agent_id = p_ct.to_user_id');
      }
    }
  });
});
