/**
 * EVERY TOURNAMENT COUNTS IN THE WEEK IT STARTS (Dan, 2026-11-14, binding)
 *
 * "ANY TOURNAMENT, SPIN, SIT N GO OR SATELLITE GAME THAT STARTS BEFORE THE CUT
 *  OFF MUST BE INCLUDED IN THE WEEK IT STARTED IN. THE INVOICES AREN'T SENT FOR
 *  4 HOURS, SO THAT GIVES MORE THEN ENOUGH TIME FOR THE EVENTS TO FINISH AND
 *  RECONCILE. MAKE SURE THATS THE CASE MOVING FORWARD..."
 *
 * Every weekly money calculation counted an event in the week it FINISHED:
 * its fee is recognized and banked at terminal time and every weekly reader
 * selected fees by that instant, and the union P&L deferred a running event's
 * result to the week it ended. This pins the rule from the week starting
 * 2026-11-16 08:00Z (Mon Nov 16, 2:00 AM Central): attribution to the start
 * week, the gate that holds a week's books until its events are terminal, the
 * union P&L boundary that holds a started event at what changes hands after
 * the cutoff, and escrowed satellite tickets held where they were won.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_tournaments_count_in_the_week_they_start.sql')
);
if (name.length !== 1) throw new Error('Expected One Start-Week Attribution Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');
const C = "'2026-11-16 08:00:00+00'";
const FIRST_BOUNDARY = "'2026-11-23 08:00:00+00'";

describe('every tournament counts in the week it starts', () => {
  it('is one transaction with short lock and statement limits', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(code).toContain("SET LOCAL lock_timeout = '1s';");
    expect(code).toContain("SET LOCAL statement_timeout = '60s';");
  });

  it('attributes a straddler to the last instant of its start week, never before the transition', () => {
    expect(code).toContain('CREATE TABLE public.accounting_tournament_week_attributions (');
    expect(code).toContain('CHECK (attributed_at < recognized_at)');
    expect(code).toContain(
      'CREATE FUNCTION public.fn_accounting_tournament_attributed_at(p_tournament_id uuid, p_recognized_at timestamptz)'
    );
    expect(code).toContain(`GREATEST(COALESCE(t.started_at, p_recognized_at), ${C}::timestamptz)`);
    expect(code).toContain(
      'ALTER TABLE public.accounting_tournament_week_attributions ENABLE ROW LEVEL SECURITY;'
    );
    expect(code).toContain(
      'REVOKE ALL ON TABLE public.accounting_tournament_week_attributions FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  it('the payable earning sources view pays a straddler in its start week', () => {
    expect(code).toContain('CREATE OR REPLACE VIEW public.accounting_payable_earning_sources');
    expect(code).toContain('accounting_tournament_week_attributions');
  });

  it("a week's books wait until every event that started in it is terminal; old weeks never wait", () => {
    expect(code).toContain(
      'CREATE FUNCTION smarter_private.week_tournaments_pending(p_kind text, p_scope uuid, p_from timestamptz, p_to timestamptz)'
    );
    expect(code).toContain(
      'CREATE FUNCTION smarter_private.week_tournaments_settled(p_kind text, p_scope uuid, p_from timestamptz, p_to timestamptz)'
    );
    expect(code).toContain(`IF p_to <= ${C}::timestamptz THEN RETURN; END IF;`);
    expect(code).toContain("'tournaments_started_in_week_not_terminal'");
    expect(code).toContain('START_WEEK_P4_OLD_WEEK_WAITS');
  });

  it('the union P&L boundary holds a started event at what changes hands after the cutoff, from Nov 23', () => {
    expect(code).toContain(`IF p_at>=${FIRST_BOUNDARY}::timestamptz THEN`);
    expect(code).toContain("'basis','start_week_post_boundary_net'");
    expect(code).toContain("'basis','escrowed_satellite_ticket'");
    expect(code).toContain("'escrowed_satellite_ticket_owner_unresolved'");
  });

  it('every inserted fragment is marked and every changed body is guarded by its preimage', () => {
    expect(
      (code.match(/START-WEEK ATTRIBUTION \(20261116\)/g) || []).length
    ).toBeGreaterThanOrEqual(20);
    expect((code.match(/md5\(pg_get_functiondef\(/g) || []).length).toBeGreaterThanOrEqual(15);
    expect(code).toContain('smarter_private.original_inventory_proof_sources_match() IS NOT TRUE');
    expect(sql).toMatch(/^-- @live-proof: .*original_inventory_proof_sources_match\(\) IS TRUE/m);
  });
});
