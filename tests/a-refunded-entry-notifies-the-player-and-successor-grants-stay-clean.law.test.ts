/**
 * LAW: every refunded tournament entry notifies the player with its exact
 * promo breakdown, and a refund successor grant never sends a misleading
 * "Promo Chips Received" push or inflates the daily promo digest's `given`.
 *
 * Background (2026-11-23):
 *   - 20261123000232 and 20261123071237 fixed wallet and ticket refunds so
 *     promo chips stay with the player instead of being swept to the sponsor.
 *   - Three connected gaps remained:
 *     1. Refunded entries sent no player notification explaining how much of
 *        the refund is promo staying under play-through.
 *     2. When 20261123071237 locked a refunded used-up ('spent') grant under a
 *        successor grant (`source_ref LIKE 'refund_successor:%'`), the grant
 *        insert trigger emitted "Promo Chips Received" as if it were new promo.
 *     3. `fn_ca_promo_daily_digest` summed every new row in
 *        `ca_promo_play_through_grants` into `given`, double-counting refund
 *        successor re-locks as fresh sponsor giveaways.
 *
 * The behaviour is proven on real PostgreSQL 17 by
 * scripts/ci/test-promo-principal-returns.py (wallet refunds),
 * scripts/ci/test-promo-ticket-principal-returns.py (ticket refunds),
 * scripts/ci/test-promo-notices.py (successor notice suppression, daily digest,
 * and refund notification wording/push bridge), and
 * scripts/ci/test-promo-custody.py (cash-table pending add-on refund & closed
 * table cash-out conservation). This file pins the source and proof wiring so
 * none of these guarantees can quietly regress.
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
const FILE = '20261123083752_a_refunded_entry_notifies_the_player_and_successor_grants_st.sql';
const SQL = read(`supabase/migrations/${FILE}`);

function between(start: string, end: string): string {
  const from = SQL.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThan(-1);
  const to = SQL.indexOf(end, from + start.length);
  expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
  return SQL.slice(from, to);
}

describe('a refunded entry notifies the player and successor grants stay clean', () => {
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
    expect(between('CREATE TABLE public.ca_promo_refund_notices', ');')).not.toMatch(/REFERENCES/i);
  });

  it('pins all four preimage definitions before replacing any function', () => {
    expect(SQL).toContain("IS DISTINCT FROM '7e72ca4cc5eac19252cfff666e743473'");
    expect(SQL).toContain("IS DISTINCT FROM '339c0009754e553056cc5971ebdea029'");
    expect(SQL).toContain("IS DISTINCT FROM 'c513741acc93dad6f8e4d272292b5ede'");
    expect(SQL).toContain("IS DISTINCT FROM '444aeaa731241745353fec64aa62763d'");
  });

  it('emits an idempotent player refund notice without moving chips or settling', () => {
    const emitter = between('CREATE FUNCTION public.fn_ca_promo_emit_refund_notice(', 'END $$;');
    expect(emitter).toContain('ON CONFLICT (ledger_id) DO NOTHING');
    expect(emitter).toContain('Of It Is Promo Chips And Stays Under Play-Through.');
    expect(emitter).toContain('From An Ended Promo Grant Returned To Its Sponsor.');
    expect(emitter).toContain('Was Refunded To Your Wallet.');
    expect(emitter).toContain('Was Refunded As A Tournament Ticket.');
    expect(emitter).not.toMatch(/UPDATE public\.(club_members|clubs|agents|union_wallets)/);
    expect(emitter).not.toContain('INSERT INTO public.chip_ledger');
    expect(emitter).not.toContain('fn_ca_promo_play_through_settle');
    expect(emitter).not.toMatch(/FOR UPDATE/);
  });

  it('invokes the refund notice emitter from both wallet and ticket refund owners', () => {
    const walletOwner = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_return_refunded_principal(',
      'END $$;'
    );
    expect(walletOwner).toContain('PERFORM public.fn_ca_promo_emit_refund_notice(');
    const ticketOwner = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_returned_ticket_principal_fee(',
      'END $function$;'
    );
    expect(ticketOwner).toContain('PERFORM public.fn_ca_promo_emit_refund_notice(');
  });

  it('skips received notices and daily given totals for refund_successor grants', () => {
    const grantNotice = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_grant_notice()',
      'END $$;'
    );
    expect(grantNotice).toContain("COALESCE(NEW.source_ref,'') LIKE 'refund_successor:%'");
    expect(grantNotice).toContain("NEW.close_reason='met'");
    expect(grantNotice).toContain("NEW.close_reason='override'");

    const digest = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_daily_digest(',
      'END $$;'
    );
    expect(digest).toContain("COALESCE(g.source_ref,'') NOT LIKE 'refund_successor:%'");
  });

  it('keeps private functions and receipts unreachable from browsers', () => {
    expect(SQL).toContain('ALTER TABLE public.ca_promo_refund_notices ENABLE ROW LEVEL SECURITY;');
    expect(SQL).toContain(
      'REVOKE ALL ON public.ca_promo_refund_notices FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_emit_refund_notice(uuid, uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_grant_notice() FROM PUBLIC,anon,authenticated,service_role;'
    );
  });

  it('wires all four PostgreSQL 17 proof suites including cash-table refunds', () => {
    expect(read('scripts/ci/test-promo-principal-returns.py')).toContain(FILE);
    expect(read('scripts/ci/test-promo-ticket-principal-returns.py')).toContain('20261123083752_');
    expect(read('scripts/ci/test-promo-notices.py')).toContain(FILE);
    expect(read('scripts/ci/test-promo-custody.py')).toContain(
      'full pending addon refund returns all promo to player wallet'
    );
    expect(read('scripts/ci/test-promo-custody.py')).toContain(
      'closed table full cashout returns all on-felt promo to player wallet'
    );
    const workflow = read('.github/workflows/promo-play-through.yml');
    expect(workflow).toContain('test-promo-principal-returns.py');
    expect(workflow).toContain('test-promo-ticket-principal-returns.py');
    expect(workflow).toContain('test-promo-notices.py');
    expect(workflow).toContain('test-promo-custody.py');
  });
});
