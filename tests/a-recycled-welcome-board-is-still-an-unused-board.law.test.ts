import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-07: every Club Create Certification since 2026-11-03 ended "11 of
// 11 stale account(s) unrecovered". Three dead runs' welcome fixtures carried
// 58-59 earlier board generations each, cancelled by the 3 AM lobby close with
// receipts that moved nothing. The owner's Retire Club door refused them as
// WELCOME_PACKAGE_BOARD_LINEAGE_AMBIGUOUS, and the certification door can
// never delete a club whose receipts are immutable.
//
// The law: an earlier generation that was cancelled with no entrant and a
// receipt that moved nothing is history, and a fixture holding only such
// history retires with its records. A generation with ONE entrant, ONE refund
// or any other movement is still refused, exactly as before.
const sql = readFileSync(
  'supabase/migrations/20261107211612_a_stale_welcome_fixture_retires_with_its_empty_past_boards.sql',
  'utf8'
);
const replacement = sql.slice(
  sql.indexOf('v_new text := $replacement$'),
  sql.indexOf('$replacement$;')
);
const door = sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_retire_stale_welcome_fixture_with_history('),
  sql.indexOf('$function$;')
);
const MOVED_NOTHING = [
  'r.source_player_count=0',
  'r.source_seat_count=0',
  'r.refunded_count=0',
  'r.refund_line_count=0',
  'r.ticket_return_count=0',
  'r.zero_refund_count=0',
  'r.total_refunded=0',
  'r.total_ticket_returned=0',
  'r.fees_reversed=0',
  'r.total_rake_before=0',
  'r.total_rake_after=0',
  'r.released_seat_count=0',
  'cardinality(r.source_player_ids)=0',
  'cardinality(r.refunded_registration_ids)=0',
  'cardinality(r.fee_reversal_ids)=0',
];

describe('a recycled welcome board is still an unused board', () => {
  it('passes a club whose only past generations were cancelled with no entrant and a receipt that moved nothing', () => {
    // The unwind's ambiguity count skips exactly that generation...
    expect(replacement).toContain("upper(COALESCE(t.status::text,''))='CANCELLED'");
    expect(replacement).toContain('COALESCE(t.current_players,0)=0 AND t.started_at IS NULL');
    for (const zero of MOVED_NOTHING) expect(replacement).toContain(zero);
    // ...and the stale door accepts exactly that generation beside untouched open boards.
    for (const zero of MOVED_NOTHING) expect(door).toContain(zero);
    expect(door).toContain("IN ('REGISTERING','ANNOUNCED')");
    expect(door).toContain("'disposition','retained_terminal_fixture_owner'");
    expect(door).toContain('public.fn_retire_settled_club(p_club_id, v_club.name, v_reason)');
  });

  it('still refuses a club with one past entrant or one refund', () => {
    // One entrant, seat or hand anywhere in the club refuses the door before anything moves.
    expect(door).toContain('public.tournament_players p JOIN public.tournaments t');
    expect(door).toContain('public.table_seats s JOIN public.tables t');
    expect(door).toContain('public.hand_history h JOIN public.tables t');
    expect(door).toContain("RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_HAS_PLAY'");
    // A cancellation that refunded anything is neither an open board nor moved-nothing history.
    expect(door).toContain("RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_TOURNAMENT_HISTORY_REFUSED'");
    // In the unwind such a generation still counts, so the board stays ambiguous,
    // and the play check that follows it is untouched.
    expect(replacement).toContain('r.total_refunded=0');
    expect(sql).not.toContain("WELCOME_PACKAGE_HAS_PLAY_OR_REGISTRATION_HISTORY' USING");
  });

  it('patches only the installed unwind it read, at one anchor, and keeps every other refusal', () => {
    expect(sql).toContain("md5(v_def) IS DISTINCT FROM 'b56b2a0f35e0fd3aa178dbd12f72fa25'");
    expect(sql).toContain("RAISE EXCEPTION 'WELCOME_UNWIND_AMBIGUITY_ANCHOR_NOT_UNIQUE'");
    expect(sql).toContain('EXECUTE replace(v_def, v_old, v_new);');
  });

  it('is a service-role door for reserved certification fixtures only, never a real club', () => {
    expect(door).toContain("RAISE EXCEPTION 'service_role_only'");
    expect(door).toContain("'fade0000-0000-0000-0000-000000000001'::uuid");
    expect(door).toContain("v_club.name NOT LIKE 'Crest Cert %'");
    expect(door).toContain("LIKE 'ca-customization-cert-postdeploy-%@example.invalid'");
    expect(door).toContain("RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_HAS_NO_HISTORY'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_retire_stale_welcome_fixture_with_history\(uuid,text\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_retire_stale_welcome_fixture_with_history\(uuid,text\)\s+TO service_role;/
    );
  });

  it('never deletes the club or a receipt', () => {
    expect(door).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.tournament_cancellation_receipts/i);
  });

  it('is what the stale sweep asks, and only for the board lineage refusal', () => {
    const sweep = readFileSync('scripts/ci/production-e2e-account.mjs', 'utf8');
    expect(sweep).toContain(
      "export const STALE_WELCOME_HISTORY_DOOR = 'fn_ca_retire_stale_welcome_fixture_with_history';"
    );
    expect(sweep).toContain("message === 'WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED' &&");
    expect(sweep).toContain('account?.templateFixtureRequest?.clubId !== clubId');
  });
});
