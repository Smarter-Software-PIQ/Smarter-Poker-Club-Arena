/**
 * LAW - THE BBJ DRIFT ALARM ANSWERS INSIDE ITS TIMEOUT
 *
 * FeeReconciler.auditBBJDrift calls bbj_drift_since(now() - 1 day) every hour
 * as the service role, whose statements stop at 8 s. Cold, the body took 18 s
 * on production (2026-11-26): one random probe of bbj_contributions per hand,
 * about 26,000 of them. So the alarm that compares booked BBJ with banked BBJ
 * was cancelled whenever the bank was not cached.
 *
 * Migration 20261126222226 reads the bank as one range of a covering index,
 * grouped by hand, and probes a hand by id only when the range holds nothing
 * for it. 20261126203947 (materialized CTEs, still one probe per hand) was
 * refused on install and reverted by #12154.
 *
 * This law keeps the newest definition in that shape and with the same
 * meaning, keeps both covering indexes declared, and keeps the install proof
 * from calling the function or reading the ledgers.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const strip = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const DEFINES = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.bbj_drift_since\s*\(/i;
const FIX = '20261126222226_the_bbj_drift_alarm_installs_inside_its_budget.sql';

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const sqlOf = (f: string) => strip(readFileSync(join(MIGRATIONS, f), 'utf8'));
const definers = files.filter((f) => DEFINES.test(sqlOf(f)));
const NEWEST = definers[definers.length - 1];
const newestSql = sqlOf(NEWEST);

// The function runs from CREATE ... FUNCTION to the end of its $function$ body.
const FUNCTION =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.bbj_drift_since\s*\([\s\S]*?\$function\$([\s\S]*?)\$function\$\s*;/i;
const fnMatch = FUNCTION.exec(newestSql);
const fn = fnMatch?.[0] ?? '';
const body = fnMatch?.[1] ?? '';

const declares = (re: RegExp) => files.some((f) => re.test(sqlOf(f)));

describe('LAW: the BBJ drift alarm answers inside its timeout', () => {
  it('the newest definition is the range-read form or a later one', () => {
    expect(NEWEST >= FIX).toBe(true);
  });

  it('keeps the signature, the six columns and the invoker shape', () => {
    expect(fn).toMatch(/bbj_drift_since\s*\(\s*p_since\s+timestamp with time zone\s*\)/i);
    expect(fn).toMatch(
      /RETURNS TABLE\s*\(\s*booked numeric,\s*received numeric,\s*booked_rows bigint,\s*received_rows bigint,\s*unlinkable_rows bigint,\s*unlinkable_chips numeric\s*\)/i
    );
    expect(fn).toMatch(/LANGUAGE sql/i);
    expect(fn).toMatch(/\bSTABLE\b/i);
    expect(fn).not.toMatch(/SECURITY DEFINER/i);
    expect(fn).toMatch(/SET search_path TO 'public'/i);
  });

  it('reads rake_records once and keeps the booked side, the grace and the unlinkable count', () => {
    expect(body.match(/\brake_records\b/gi)?.length).toBe(1);
    expect(body).toMatch(/created_at\s*>=\s*p_since\b(?!\s*-)/i);
    expect(body).toMatch(/bbj_contribution\s*>\s*0/i);
    // Settle grace strictly greater than fn_bbj_repair_unbanked's 5 minutes.
    expect(body).toMatch(/created_at\s*<\s*now\(\)\s*-\s*interval\s*'6 minutes'/i);
    expect(body).toMatch(/hand_id\s+IS\s+NULL/i);
  });

  it('reads the bank as one fenced range that starts at least a day before the window', () => {
    expect(body).toMatch(/bank_range\s+AS\s+MATERIALIZED\s*\(/i);
    const range =
      /bank_range\s+AS\s+MATERIALIZED\s*\(([\s\S]*?)\)\s*,\s*bank_window/i.exec(body)?.[1] ?? '';
    expect(range).toMatch(/FROM\s+bbj_contributions\b/i);
    const slack =
      /created_at\s*>=\s*p_since\s*-\s*interval\s*'(\d+)\s+(day|days|hour|hours)'/i.exec(range);
    expect(slack, 'the range must start before p_since').not.toBeNull();
    const hours = Number(slack![1]) * (/day/i.test(slack![2]) ? 24 : 1);
    expect(hours).toBeGreaterThanOrEqual(24);
    // The range is not joined to the audited hands inside the fence.
    expect(range).not.toMatch(/\bsettled\b|\br\.hand_id\b/i);
  });

  it('still joins received BY HAND: a hand the range misses is probed by id with no window', () => {
    expect(body).toMatch(/LEFT\s+JOIN\s+bank_window\s+w\s+ON\s+w\.hand_id\s*=\s*s\.hand_id/i);
    expect(body).toMatch(
      /COALESCE\s*\(\s*w\.amount\s*,\s*\(\s*SELECT\s+sum\(\s*b\.amount\s*\)\s+FROM\s+bbj_contributions\s+b\s+WHERE\s+b\.hand_id\s*=\s*s\.hand_id\s*\)\s*,\s*0\s*\)/i
    );
    // Every CTE is materialized.
    const ctes = [...body.matchAll(/(?:WITH|,)\s*([a-z_]+)\s+AS\s+(MATERIALIZED\s+)?\(/gi)];
    expect(ctes.length).toBeGreaterThanOrEqual(4);
    for (const m of ctes) expect(m[2], `CTE ${m[1]} must be MATERIALIZED`).toBeTruthy();
  });

  it('both covering indexes stay declared and are never dropped', () => {
    expect(
      declares(
        /CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+idx_rake_records_bbj_window_cover\s+ON\s+public\.rake_records\s+USING\s+btree\s*\(\s*created_at\s*\)\s+INCLUDE\s*\(\s*hand_id\s*,\s*bbj_contribution\s*\)\s+WHERE\s*\(\s*bbj_contribution\s*>\s*\(0\)::numeric\s*\)/i
      )
    ).toBe(true);
    expect(
      declares(
        /CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+idx_bbj_contrib_window_cover\s+ON\s+public\.bbj_contributions\s+USING\s+btree\s*\(\s*created_at\s*\)\s+INCLUDE\s*\(\s*hand_id\s*,\s*amount\s*\)\s+WHERE\s*\(\s*hand_id\s+IS\s+NOT\s+NULL\s*\)/i
      )
    ).toBe(true);
    expect(declares(/DROP\s+INDEX[^;]*idx_rake_records_bbj_window_cover/i)).toBe(false);
    expect(declares(/DROP\s+INDEX[^;]*idx_bbj_contrib_window_cover/i)).toBe(false);
  });

  it('the install proof never calls the function or reads the ledgers', () => {
    // 20261126203947 was refused (25P04): its proof ran the slow body inside a
    // transaction the applier stops at about 12 s, and a refused file blocks
    // every engine certification until it is reverted.
    const raw = readFileSync(join(MIGRATIONS, NEWEST), 'utf8');
    const tx = strip(raw.slice(raw.indexOf('BEGIN;')));
    const outsideFn = tx.replace(FUNCTION, '');
    expect(outsideFn).not.toBe(tx);
    expect(outsideFn).not.toMatch(/\bFROM\s+(public\.)?(rake_records|bbj_contributions)\b/i);
    expect(outsideFn).not.toMatch(/\bbbj_drift_since\s*\(\s*now\(/i);
    expect(outsideFn).not.toMatch(/PERFORM[^;]*bbj_drift_since/i);
  });
});
