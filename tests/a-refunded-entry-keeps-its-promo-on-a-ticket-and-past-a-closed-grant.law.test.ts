/**
 * LAW: a refunded entry keeps its promo with the player when the refund is
 * paid as a ticket, and when the grant closed before the refund arrived.
 *
 * 20261123000232 kept promo with the member only for a wallet refund onto an
 * open grant. Three routes still paid it to the promo fund:
 *
 *   - a refund paid as a tournament ticket paid the promo fee, the written-off
 *     promo stake and the promo still in the event to the fund and cut the
 *     ticket's value by the same amount;
 *   - a grant whose play-through was already finished (met, or released by
 *     support) lost its refunded promo fee to the fund, although those chips
 *     were the member's own;
 *   - a grant the entry itself had used up (an entry fee drains the oldest
 *     small grant first and closes it as spent) lost that fee to the fund
 *     when the entry was refunded, the same harm as the original incident.
 *
 * The promo terms end a grant only on loss or after 30 days. So the fund
 * return now stands only where those terms ended the grant (expired, left the
 * club, returned, or spent with its 30 days over), where the refund was paid
 * into another club's wallet, or where a fund receipt already exists.
 *
 * The behaviour is proven on real PostgreSQL by
 * scripts/ci/test-promo-principal-returns.py (wallet),
 * scripts/ci/test-promo-ticket-principal-returns.py (ticket) and, on the full
 * custody, integrity and profit stack, by tests/fixtures/
 * promo-ticket-play-through/refunded-entry-keeps-promo-past-a-used-up-grant.sql.
 * This file pins the source so neither the rule nor its proof can be quietly
 * removed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { migrationCostRisks } from '../scripts/ci/migration-cost-shape.mjs';
import { assertOrdinaryMigrationBudget } from '../scripts/ci/migration-session-identity.mjs';
import { ordinaryMigrationBudgetMs } from '../scripts/ci/migration-install-budget.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const FILE = '20261123071237_a_refunded_entry_keeps_its_promo_on_a_ticket_and_past_a_clos.sql';
const SQL = read(`supabase/migrations/${FILE}`);

function between(start: string, end: string): string {
  const from = SQL.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThan(-1);
  const to = SQL.indexOf(end, from + start.length);
  expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
  return SQL.slice(from, to);
}

describe('a refunded entry keeps its promo on a ticket and past a closed grant', () => {
  it('is an ordinary single-transaction migration that locks no live table', () => {
    const shape = migrationTransactionShape(FILE, SQL);
    expect(shape.ok ? 'ok' : shape.reason).toBe('ok');
    expect(migrationCostRisks(FILE, SQL)).toEqual([]);
    expect(() =>
      assertOrdinaryMigrationBudget(SQL, ordinaryMigrationBudgetMs(FILE, SQL))
    ).not.toThrow();
    expect(missingProbes(SQL)).toEqual([]);
    expect(SQL).not.toMatch(/@install-window/);
    expect(SQL).not.toMatch(/SET CONSTRAINTS/i);
    expect(between('CREATE TABLE public.ca_promo_refund_keep_receipts', ');')).not.toMatch(
      /REFERENCES/i
    );
  });

  it('refuses to install over an owner it has not read', () => {
    expect(SQL).toContain("IS DISTINCT FROM '4063bb8e975723cc64199c78a9836501'");
    expect(SQL).toContain(
      "NOT IN ('149d0317934447c9d6983d69cd8c4b4e', '0e9d2d30d9d2aed286c114f07bb4d136')"
    );
  });

  it('decides a wallet refund by why the grant closed, never by closure alone', () => {
    const restore = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_restore_refunded_entry_cost(',
      'END $$;'
    );
    const decision = restore.slice(
      restore.indexOf('treatment := CASE'),
      restore.indexOf('IF treatment IS NULL THEN RETURN NULL; END IF;')
    );
    expect(decision).toContain(
      "WHEN g.closed_at IS NOT NULL AND g.close_reason IN ('met', 'override') THEN 'released'"
    );
    expect(decision).toContain('WHEN g.club_id IS DISTINCT FROM e.refund_wallet_club_id THEN NULL');
    expect(decision).toContain("WHEN g.closed_at IS NULL THEN 'restore'");
    expect(decision).toContain(
      "WHEN g.close_reason = 'spent' AND g.expires_at > clock_timestamp() THEN 'successor'"
    );
    // Expired, left-club and returned grants are named nowhere: they fall
    // through to NULL and keep the fund return the promo terms give them.
    expect(decision).not.toMatch(/expired|left_club|'returned'/);
    // A cost already paid to the fund is never also kept.
    expect(restore.indexOf('ca_promo_principal_return_receipts')).toBeLessThan(
      restore.indexOf('treatment := CASE')
    );
    // It moves no chips and never reopens a closed grant.
    expect(restore).not.toMatch(/UPDATE public\.(club_members|clubs|agents|union_wallets)/);
    expect(restore).not.toMatch(/closed_at\s*=\s*NULL/i);
    expect(restore).not.toContain('INSERT INTO public.chip_ledger');
    expect(restore).not.toContain('fn_ca_promo_play_through_settle');
  });

  it('writes a successor exactly like the grant it follows and never settles in a refund', () => {
    const successor = between(
      'CREATE FUNCTION public.fn_ca_promo_refund_successor_grant(',
      'END $$;'
    );
    expect(successor).toContain(
      "g.closed_at IS NULL OR g.close_reason IS DISTINCT FROM 'spent' OR g.expires_at <= granted"
    );
    expect(successor).toContain(
      'g.club_id, g.user_id, p_amount, p_amount, g.multiplier, g.source_kind, ref,'
    );
    expect(successor).toContain('NULL, g.funded_from_type, g.funded_from_id,');
    expect(successor).toContain('granted, g.expires_at)');
    expect(successor).not.toContain('make_interval');
    expect(successor).not.toMatch(/PERFORM public\.fn_ca_promo_play_through_settle/);
    expect(successor).not.toMatch(/UPDATE public\.(club_members|clubs|agents|union_wallets)/);
    expect(successor).not.toContain('INSERT INTO public.chip_ledger');
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_refund_successor_grant(uuid, numeric, text, text, uuid)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  it('keeps promo on a refund ticket before it ever reaches the fund return', () => {
    const owner = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(',
      'END $function$'
    );
    const decision = owner.indexOf('treatment:=CASE');
    const firstFundLock = owner.indexOf("source_label:='union_wallets.promo_wallet';SELECT");
    const fundJournal = owner.indexOf('INSERT INTO public.chip_ledger(');
    expect(decision).toBeGreaterThan(-1);
    expect(decision).toBeLessThan(firstFundLock);
    expect(decision).toBeLessThan(fundJournal);
    const kept = owner.slice(decision, firstFundLock);
    expect(kept).toContain(
      "WHEN r.closed_at IS NOT NULL AND r.close_reason IN('met','override') THEN 'released'"
    );
    expect(kept).toContain('WHEN r.club_id IS DISTINCT FROM e.refund_wallet_club_id THEN NULL');
    expect(kept).toContain("WHEN r.closed_at IS NULL THEN 'ticket_restore'");
    expect(kept).toContain(
      "WHEN r.close_reason='spent' AND r.expires_at>clock_timestamp() THEN 'successor' END;"
    );
    expect(kept).toContain("VALUES(r.id,'ticket',t.id,kept)");
    expect(kept).toContain("fn_ca_promo_refund_successor_grant(r.id,kept,operation,'ticket',t.id)");
    // Every kept grant leaves the loop before any fund is locked or credited.
    expect(kept.match(/CONTINUE;/g) ?? []).toHaveLength(2);
    // The fund path only counts what it actually pays.
    expect(owner).toContain('fund_total:=fund_total+r.amount;');
    expect(owner).toContain(
      "WHERE entitlement_id=e.id),0)<>fund_total THEN RAISE EXCEPTION 'original_ticket_Pfee_return_incomplete'"
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(uuid, uuid, uuid)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  it('keeps every real-database proof wired into the required promo workflow', () => {
    const wallet = read('scripts/ci/test-promo-principal-returns.py');
    expect(wallet).toContain("label='promo-refunded-entry-keeps-promo-past-a-closed-grant'");
    expect(wallet).toContain('a finished play-through was locked again');
    expect(wallet).toContain(
      'a used-up grant did not lock its refunded promo again under successors'
    );
    expect(wallet).toContain('(10,True,True,False,True)');
    const ticket = read('scripts/ci/test-promo-ticket-principal-returns.py');
    expect(ticket).toContain("label='refunded-ticket-entry-keeps-promo'");
    expect(ticket).toContain(
      "for mode in ['met','active','lost','lapsed','crossclub','terminal']:"
    );
    expect(ticket).toContain('a kept refund paid the promo fund');
    expect(ticket).toContain('the refund ticket lost value');
    expect(ticket).toContain('late keep-receipt fault retained asset, promo or receipt');
    expect(ticket).toContain(
      'kept promo did not follow the ticket into the next event still locked'
    );
    expect(ticket).toContain('a grant the promo terms ended was kept');
    const financial = read('scripts/ci/test-promo-tournament-earning-financial.py');
    expect(financial).toContain('refunded-entry-keeps-promo-past-a-used-up-grant.sql');
    const fixture = read(
      'tests/fixtures/promo-ticket-play-through/refunded-entry-keeps-promo-past-a-used-up-grant.sql'
    );
    expect(fixture).toContain('opening did not let the entry fee use up the oldest small grant');
    expect(fixture).toContain('refund paid promo to the fund');
    expect(fixture).toContain('refund turned promo into cashable chips');
    expect(fixture).toContain('successor grant differs from the grant it follows');
    const workflow = read('.github/workflows/promo-play-through.yml');
    expect(workflow).toContain('supabase/migrations/*_a_refunded_entry_keeps_its_promo_*.sql');
    expect(workflow).toContain('scripts/ci/test-promo-ticket-principal-returns.py');
    expect(workflow).toContain('scripts/ci/test-promo-principal-returns.py');
  });
});
