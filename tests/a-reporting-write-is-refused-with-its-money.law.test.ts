/**
 * LAW: A REPORTING WRITE IS REFUSED WITH ITS MONEY (2026-11-23).
 *
 * Club Data's reporting rows are written by triggers inside the money
 * transaction that causes them (ca_club_data_fact_wallet and
 * ca_reporting_wallet_insert on wallet_transactions, ca_club_data_fact_rake
 * and ca_reporting_rake_insert on rake_records). Every one of those writes sat
 * under an EXCEPTION WHEN OTHERS handler that logged a WARNING and carried on.
 * In the 24 hours to 2026-11-23 07:15 UTC that turned 126 lock timeouts (the
 * rake banker's 250ms) and 2 deadlocks into reports that never happened while
 * the money moved: the rake banked, its Club Data rows did not.
 *
 * 20261123072817 opens each of the thirteen handlers in the seven reporting
 * functions with
 *   IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;
 * so a refusal a retry can change refuses the money statement with it (the
 * rake bank answers busy and banks the same obligation, with its report, on
 * its next pass), while a deterministic reporting defect is still contained.
 *
 * This law reads each live body (production's text: the migration that last
 * wrote it, or scripts/dev/fixtures/one-lock-order-live-2026-11-23.json, md5
 * pinned), applies the migration's own replacement, and requires every
 * handler to carry the guard. Any LATER migration that defines one of the
 * seven literally must keep the guard on every WHEN OTHERS handler, and no
 * later anchored edit may take it out. The native proof is
 * scripts/dev/prove-reporting-and-seat-writers-take-one-order.sh.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');
const MIGRATION = '20261123072817_a_reporting_write_is_refused_with_its_money.sql';
const sql = readFileSync(resolve(DIR, MIGRATION), 'utf8');
const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/dev/fixtures/one-lock-order-live-2026-11-23.json'), 'utf8')
) as { functions: Array<{ signature: string; production_md5: string; definition: string }> };

const OLD = 'EXCEPTION WHEN OTHERS THEN';
const GUARD =
  'EXCEPTION WHEN OTHERS THEN /* A CONCURRENCY REFUSAL REFUSES ITS MONEY TOO (20261123072817) */ IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;';

function fromMigration(file: string, fn: string): string {
  const s = readFileSync(resolve(DIR, file), 'utf8');
  const i = s.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
  expect(i, `${fn} is defined in ${file}`).toBeGreaterThan(-1);
  const tag = /AS (\$[A-Za-z_]*\$)/.exec(s.slice(i))!;
  const bodyStart = i + tag.index + tag[0].length;
  return s.slice(i, s.indexOf(tag[1], bodyStart) + tag[1].length);
}
function fromFixture(signature: string): string {
  const f = fixture.functions.find((x) => x.signature === signature);
  expect(f, `${signature} is in the live-body fixture`).toBeTruthy();
  return f!.definition;
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

const SEVEN: Array<{ tag: string; fn: string; handlers: number; body: () => string }> = [
  {
    tag: 'fact_put',
    fn: 'public.fn_ca_club_data_fact_put',
    handlers: 3,
    body: () =>
      fromFixture(
        'public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamp with time zone)'
      ),
  },
  {
    tag: 'hand_put',
    fn: 'public.fn_ca_club_data_hand_put',
    handlers: 3,
    body: () => fromFixture('public.fn_ca_club_data_hand_put(uuid,uuid,timestamp with time zone)'),
  },
  {
    tag: 'cash_register',
    fn: 'public.fn_ca_club_data_pacific_cash_register',
    handlers: 1,
    body: () => fromFixture('public.fn_ca_club_data_pacific_cash_register(uuid)'),
  },
  {
    tag: 'rake_fact',
    fn: 'public.trg_ca_club_data_fact_rake',
    handlers: 2,
    body: () => fromFixture('public.trg_ca_club_data_fact_rake()'),
  },
  {
    tag: 'rake_rollup',
    fn: 'public.trg_ca_reporting_rake_insert',
    handlers: 1,
    body: () =>
      fromMigration(
        '20261017204111_the_club_data_report_reads_what_the_club_played.sql',
        'public.trg_ca_reporting_rake_insert'
      ),
  },
  {
    tag: 'wallet_fact',
    fn: 'public.trg_ca_club_data_fact_wallet',
    handlers: 1,
    body: () =>
      fromMigration(
        '20261017160125_club_data_counts_what_the_club_played.sql',
        'public.trg_ca_club_data_fact_wallet'
      ),
  },
  {
    tag: 'wallet_rollup',
    fn: 'public.trg_ca_reporting_wallet_insert',
    handlers: 2,
    body: () =>
      fromMigration(
        '20261017204111_the_club_data_report_reads_what_the_club_played.sql',
        'public.trg_ca_reporting_wallet_insert'
      ),
  },
];

/** The $o$ needle and $r$ replacement of the edit block a DO tag names. */
function edit(tag: string): { old: string; next: string; block: string } {
  const start = sql.indexOf(`DO $${tag}$`);
  expect(start, `the ${tag} edit block exists`).toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf(`$${tag}$;`, start + tag.length + 4));
  const o = block.indexOf('$o$');
  const r = block.indexOf('$r$');
  return {
    old: block.slice(o + 3, block.indexOf('$o$', o + 3)),
    next: block.slice(r + 3, block.indexOf('$r$', r + 3)),
    block,
  };
}

describe('1. every reporting handler re-raises a refusal a retry can change', () => {
  for (const { tag, fn, handlers, body } of SEVEN) {
    it(`${fn}: ${handlers} handler(s), each guarded after the edit`, () => {
      const live = body();
      const { old, next, block } = edit(tag);
      expect(old).toBe(OLD);
      expect(next).toBe(GUARD);
      expect(count(live, OLD)).toBe(handlers);
      // No other kind of handler hides in the body.
      expect(count(live, 'EXCEPTION WHEN')).toBe(handlers);
      expect(count(live, 'bank_refusal_is_transient')).toBe(0);
      expect(block).toContain(`<> ${handlers} THEN`);
      const after = live.split(OLD).join(GUARD);
      expect(count(after, GUARD)).toBe(count(after, 'EXCEPTION WHEN'));
    });
  }

  it('the thirteen handlers are all of them, and the file verifies thirteen', () => {
    expect(SEVEN.reduce((n, f) => n + f.handlers, 0)).toBe(13);
    expect(sql).toContain('IF v_total <> 13 THEN');
  });

  it("uses the banker's own transient test, which keeps a defect contained", () => {
    const t = fromFixture('smarter_private.bank_refusal_is_transient(text)');
    expect(t).toContain("left(p_sqlstate, 2) IN ('40', '53', '57', '08')");
    expect(t).toContain("p_sqlstate IN ('55P03', '55006')");
    expect(sql).toContain("NOT smarter_private.bank_refusal_is_transient('22P02')");
  });

  it('the rake banker answers busy for a lock refusal and leaves the obligation stored', () => {
    const banker = fromFixture('public.fn_ca_bank_pending_cash_rake(uuid)');
    expect(banker).toContain("PERFORM set_config('lock_timeout', '250ms', true);");
    expect(banker).toMatch(
      /WHEN lock_not_available THEN\s+PERFORM set_config\('lock_timeout', v_lock_timeout, true\);\s+RETURN jsonb_build_object\('status', 'busy'/
    );
  });

  it('probes the three callable functions after the verify block and exempts the four triggers', () => {
    for (const { fn } of SEVEN) {
      const probed = sql.includes(`-- @probe-for: ${fn}\n`);
      const exempt = new RegExp(
        `^-- @probe-exempt: ${fn.replace('.', '\\.')} is a trigger function`,
        'm'
      ).test(sql);
      expect(probed !== exempt, `${fn} is either probed or exempt`).toBe(true);
      if (fn.includes('.trg_')) expect(exempt).toBe(true);
    }
    expect(sql.indexOf('DO $verify_reporting$')).toBeLessThan(sql.indexOf('-- @probe-for:'));
  });
});

const later = readdirSync(DIR)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION)
  .map((file) => ({ file, source: readFileSync(resolve(DIR, file), 'utf8') }));

describe('2. no later migration swallows a concurrency refusal in a reporting write again', () => {
  it('a later literal definition of one of the seven keeps the guard on every WHEN OTHERS handler', () => {
    for (const { file, source } of later) {
      for (const { fn } of SEVEN) {
        const at = source.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
        if (at < 0) continue;
        const tag = /AS (\$[A-Za-z_]*\$)/.exec(source.slice(at))!;
        const bodyStart = at + tag.index + tag[0].length;
        const body = source.slice(bodyStart, source.indexOf(tag[1], bodyStart));
        const handlers = [...body.matchAll(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/gi)];
        for (const h of handlers) {
          expect(
            body.slice(h.index!, h.index! + 220),
            `${file}: ${fn} re-raises a transient refusal first`
          ).toMatch(/bank_refusal_is_transient\(SQLSTATE\)\s+THEN\s+RAISE;/);
        }
      }
    }
  });

  it('no later anchored edit takes the guard out', () => {
    for (const { file, source } of later) {
      for (const block of source.matchAll(/\$o\$([\s\S]*?)\$o\$[\s\S]*?\$r\$([\s\S]*?)\$r\$/g)) {
        if (block[1].includes('bank_refusal_is_transient(SQLSTATE)')) {
          expect(block[2], `${file} keeps the reporting guard`).toContain(
            'bank_refusal_is_transient(SQLSTATE)'
          );
        }
      }
    }
  });
});
