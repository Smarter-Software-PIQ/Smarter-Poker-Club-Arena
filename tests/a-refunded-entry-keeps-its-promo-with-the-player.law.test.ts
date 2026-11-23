/**
 * LAW: a refunded tournament entry keeps its promo with the player.
 *
 * On 2026-11-22 two members were unregistered from a Sit & Go satellite that
 * never filled. Each got the entry back, and the same transaction then took
 * the promo part of it out of the wallet and paid it to the promo fund: nine
 * "Reversal" lines on one member's chip statement for an event she never
 * played. The accepted promo terms end a grant only when its chips are lost
 * or after 30 days, and a refunded entry is neither.
 *
 * The behaviour itself is proven on real PostgreSQL by
 * scripts/ci/test-promo-principal-returns.py and, on the full custody,
 * integrity and profit stack, by tests/fixtures/promo-ticket-play-through/
 * refunded-entry-keeps-promo.sql. This file pins the source so neither the
 * rule nor its proof can be quietly removed.
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
const FILE = '20261123000232_a_refunded_entry_keeps_its_promo_with_the_player.sql';
const SQL = read(`supabase/migrations/${FILE}`);

function between(start: string, end: string): string {
  const from = SQL.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThan(-1);
  const to = SQL.indexOf(end, from + start.length);
  expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
  return SQL.slice(from, to);
}

describe('a refunded entry keeps its promo with the player', () => {
  it('is an ordinary single-transaction migration that locks no live table', () => {
    const shape = migrationTransactionShape(FILE, SQL);
    expect(shape.ok ? 'ok' : shape.reason).toBe('ok');
    expect(migrationCostRisks(FILE, SQL)).toEqual([]);
    expect(() =>
      assertOrdinaryMigrationBudget(SQL, ordinaryMigrationBudgetMs(FILE, SQL))
    ).not.toThrow();
    expect(missingProbes(SQL)).toEqual([]);
    expect(SQL).not.toMatch(/@install-window/);
    // A receipt table never carries a foreign key to a live relation.
    expect(between('CREATE TABLE public.ca_promo_refund_restore_receipts', ');')).not.toMatch(
      /REFERENCES/i
    );
  });

  it('refuses to install over a refund owner it has not read', () => {
    expect(SQL).toContain("IS DISTINCT FROM '69ca54bcfac62ebe2e03987bdf1cda75'");
    expect(SQL).toContain(
      "NOT IN ('15b0d4f78cdc7940425c7cdae8c76270', '9de436b1f7c01c95f2b4574a37a9f3bb')"
    );
  });

  it('pays refunded principal to a fund only across clubs or on an existing receipt', () => {
    const owner = between(
      'CREATE OR REPLACE FUNCTION public.fn_ca_promo_return_refunded_principal(',
      'END $$;'
    );
    const calls = owner.match(/fn_ca_promo_return_principal\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const guard = owner.slice(owner.indexOf('IF r.club_id IS DISTINCT FROM l.club_id'));
    expect(guard.indexOf('IF r.club_id IS DISTINCT FROM l.club_id')).toBe(0);
    expect(guard).toContain('ca_promo_principal_return_receipts');
    expect(guard.indexOf('fn_ca_promo_return_principal(')).toBeLessThan(guard.indexOf('END IF;'));
    // Nothing else in the owner moves principal: no unconditional return.
    expect(owner.slice(0, owner.indexOf('IF r.club_id IS DISTINCT FROM l.club_id'))).not.toContain(
      'fn_ca_promo_return_principal('
    );
  });

  it('tries the player first for a refunded promo fee and a written-off entry stake', () => {
    const owner = between('DO $spent_fee_owner$', 'END $spent_fee_owner$;');
    for (const reason of ['fee_refund', 'loss_refund']) {
      const restore = owner.indexOf(
        `fn_ca_promo_restore_refunded_entry_cost(r.grant_id, '${reason}'`
      );
      const fund = owner.indexOf(
        `fn_ca_promo_return_principal(r.grant_id, 'player_wallet', '${reason}'`
      );
      expect(restore, `${reason} is never offered to the player`).toBeGreaterThan(-1);
      expect(fund, `${reason} lost its original fund route`).toBeGreaterThan(restore);
      expect(owner.slice(restore, fund)).toContain('IF restored IS NULL THEN');
    }
    // Both bases the lost-entry loop may read stay nameable by later owners.
    expect(owner).toContain("'JOIN public.ca_promo_original_entry_loss_basis fs'");
    expect(owner).toContain("'JOIN public.ca_promo_event_entry_loss_slices fs'");
  });

  it('restores only onto the original open grant in the refund wallet and keeps it locked', () => {
    const restore = between(
      'CREATE FUNCTION public.fn_ca_promo_restore_refunded_entry_cost(',
      'END $$;'
    );
    expect(restore).toContain(
      'g.closed_at IS NOT NULL OR g.club_id IS DISTINCT FROM e.refund_wallet_club_id'
    );
    expect(restore).toContain('IF g.remaining + p_amount > g.amount THEN');
    expect(restore).toContain('SET remaining = remaining + p_amount');
    expect(restore).toContain("VALUES (g.id, 'player_wallet', e.user_id, p_amount)");
    expect(restore).toContain('INSERT INTO public.ca_promo_refund_restore_receipts(');
    // It moves no chips and never reopens a closed grant.
    expect(restore).not.toMatch(/UPDATE public\.(club_members|clubs|agents|union_wallets)/);
    expect(restore).not.toMatch(/closed_at\s*=\s*NULL/i);
    expect(restore).not.toContain('INSERT INTO public.chip_ledger');
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_restore_refunded_entry_cost(uuid, text, numeric, uuid, uuid)'
    );
    for (const owner of [
      'fn_ca_promo_return_spent_event_fee',
      'fn_ca_promo_return_refunded_principal',
    ]) {
      expect(SQL).toContain(
        `REVOKE ALL ON FUNCTION public.${owner}(uuid)\n  FROM PUBLIC, anon, authenticated, service_role;`
      );
    }
  });

  it('keeps the real-database proof wired into the required promo workflow', () => {
    const returns = read('scripts/ci/test-promo-principal-returns.py');
    expect(returns).toContain("label='promo-refunded-entry-keeps-promo'");
    expect(returns).toContain('actual-exact-entry-refund-keeps-promo-with-the-member');
    expect(returns).toContain('exact refund took promo away from the member or moved the fund');
    // 20261123071237 widened what stays with the member; its own law pins the
    // closed-grant and ticket treatments. The open-grant restore is still here.
    expect(returns).toContain(
      "treatment='fund' if cross or lapsed else 'successor' if lost else 'released' if closed else 'restore'"
    );
    expect(returns).toContain("kept=treatment=='restore'");
    const financial = read('scripts/ci/test-promo-tournament-earning-financial.py');
    expect(financial).toContain('refunded-entry-keeps-promo.sql');
    const fixture = read('tests/fixtures/promo-ticket-play-through/refunded-entry-keeps-promo.sql');
    expect(fixture).toContain('refund took promo out of the member wallet');
    expect(fixture).toContain('refund paid promo to the fund');
    expect(fixture).toContain('refund turned promo into cashable chips');
    const workflow = read('.github/workflows/promo-play-through.yml');
    expect(workflow).toContain('supabase/migrations/*_a_refunded_entry_keeps_its_promo_*.sql');
    expect(workflow).toContain('scripts/ci/test-promo-principal-returns.py');
  });
});
