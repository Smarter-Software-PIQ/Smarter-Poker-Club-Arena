/**
 * LAW: A REFUSED HAND OBLIGATION NEVER HOLDS ITS TABLE (2026-11-18).
 *
 * Incident d2d79c4f: one stored rake (hand 59989058) refused 23514 on every
 * attempt, about once a second, 7,000+ times; the outbox finish refused to let
 * the hand leave while its rake was stored, the engine's per-table chain
 * stopped at that hand, and 22 later rakes of the same table were never asked.
 *
 * What this pins:
 *   1. The two bankers classify refusals: transient SQLSTATEs (class 40, 53,
 *      57, 08, 55P03, 55006) stay retryable; every other refusal is terminal,
 *      stamped with the money-law epoch read BEFORE the attempt, and named once
 *      at the source as a critical financial_alerts row.
 *   2. A terminal obligation is answered without running again while the law
 *      is unchanged (no hot retry loop).
 *   3. A terminal obligation does not hold its hand: the projection pass and
 *      the outbox finish accept 'terminal'.
 *   4. The re-ask is the code change itself: an event trigger on function DDL
 *      moves the epoch, and the table's next pass asks stale refusals again.
 *      No timer, sweeper or repair job (no cron.schedule in the migration).
 *   5. Every LATER migration that redefines one of these functions keeps the
 *      law's markers, so a redefinition cannot silently drop it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = join(resolve(__dirname, '..'), 'supabase/migrations');
const LAW = '20261118192000_a_refused_hand_obligation_never_holds_its_table.sql';
const sql = readFileSync(join(DIR, LAW), 'utf8');

/** The body of one CREATE OR REPLACE FUNCTION statement in a migration. */
function fnBody(text: string, qualified: string): string | null {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION ${qualified}(`);
  if (start < 0) return null;
  const open = text.indexOf('$function$', start);
  const close = text.indexOf('$function$', open + 10);
  return text.slice(start, close + 10);
}

const MARKERS: Record<string, string[]> = {
  'public.fn_ca_bank_pending_cash_rake': [
    'smarter_private.money_law_epoch()',
    'smarter_private.bank_refusal_is_transient(v_state)',
    'terminal_epoch = v_epoch',
    "'bank_obligation_terminal_refusal'",
    "'status', 'terminal'",
  ],
  'public.fn_ca_bank_pending_hand_obligations': [
    'smarter_private.money_law_epoch()',
    'smarter_private.bank_refusal_is_transient(v_state)',
    'terminal_epoch = v_epoch',
    "'bank_obligation_terminal_refusal'",
    "'status', 'terminal'",
  ],
  'public.fn_project_hand_side_effects': [
    "IS DISTINCT FROM 'terminal'",
    'terminal_epoch < smarter_private.money_law_epoch()',
  ],
  'public.trg_finish_hand_post_commit_obligations': ["NOT IN ('banked', 'terminal')"],
};

describe('a refused hand obligation never holds its table', () => {
  it('the bankers, the projection pass and the outbox finish carry the law', () => {
    for (const [fn, markers] of Object.entries(MARKERS)) {
      const body = fnBody(sql, fn);
      expect(body, `${fn} is redefined by ${LAW}`).not.toBeNull();
      for (const m of markers) expect(body, `${fn} keeps ${m}`).toContain(m);
    }
  });

  it('only a refusal a retry can change is retried', () => {
    const cls = fnBody(sql, 'smarter_private.bank_refusal_is_transient');
    expect(cls).not.toBeNull();
    for (const s of ["'40'", "'53'", "'57'", "'08'", "'55P03'", "'55006'"]) expect(cls).toContain(s);
    // A check, data or privilege refusal is never transient.
    for (const s of ["'23", "'22", "'42", "'P0"]) expect(cls).not.toContain(s);
  });

  it('the epoch is read before the attempt, so old code never stamps a new law', () => {
    for (const fn of ['public.fn_ca_bank_pending_cash_rake', 'public.fn_ca_bank_pending_hand_obligations']) {
      const body = fnBody(sql, fn)!;
      const read = body.indexOf('v_epoch := smarter_private.money_law_epoch()');
      expect(read).toBeGreaterThan(0);
      expect(read).toBeLessThan(body.indexOf('FOR UPDATE SKIP LOCKED'));
    }
  });

  it('the re-ask is the code change, not a timer', () => {
    expect(sql).toMatch(/CREATE EVENT TRIGGER ca_money_law_change_reasks_refusals ON ddl_command_end/);
    expect(sql).toContain("WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE PROCEDURE', 'ALTER PROCEDURE')");
    expect(sql).not.toMatch(/cron\.schedule/);
  });

  it('a terminal obligation is paged at its source, not again by the stranded watchdog', () => {
    const wd = fnBody(sql, 'public.fn_post_commit_stranded_watchdog')!;
    expect(wd).toContain('rp.terminal_epoch is null or rp.terminal_epoch < smarter_private.money_law_epoch()');
    expect(wd).toContain('bp.terminal_epoch is null or bp.terminal_epoch < smarter_private.money_law_epoch()');
  });

  it('no later migration redefines these functions without the law', () => {
    const later = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f > LAW).sort();
    for (const f of later) {
      const text = readFileSync(join(DIR, f), 'utf8');
      for (const [fn, markers] of Object.entries(MARKERS)) {
        const body = fnBody(text, fn);
        if (!body) continue;
        for (const m of markers) expect(body, `${f} redefines ${fn} and must keep ${m}`).toContain(m);
      }
    }
  });
});
