/**
 * The place-evidence guard uses the key index (2026-11-17).
 *
 * Nightly 20K 10d3c9b3 (621 entrants) reached one player at 07:05:18Z and
 * stayed RUNNING with first place unpaid: every terminal settlement ran its
 * full 45 s of CPU and was cancelled. The cost was one guard in
 * fn_settle_tournament_places that joins tournament_obligations to
 * wallet_credit_idempotency on a LIKE pattern computed per obligation. No
 * index can serve that, so it seq-scanned all 1.9M wallet credits once per
 * paid place (93 x 1.9M = 177M comparisons, 19.3 s even with three parallel
 * workers). 20261117085019 adds the tournament's constant key prefix as a
 * byte-wise range on wallet_credit_idempotency_key_pattern_idx: 7.5 ms.
 *
 * The regression vector is a later migration that rewrites the function from
 * an older body, or re-amends the guard, and drops the range. This law pins
 * the range in the fixing migration and in every later rewrite.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');

const FIX = '20261117085019_place_evidence_guard_uses_the_key_index.sql';
const LOWER = "k.key OPERATOR(pg_catalog.~>=~) (''tourney:'' || p_tournament_id::text || '':obl:'')";
const UPPER = "k.key OPERATOR(pg_catalog.~<~) (''tourney:'' || p_tournament_id::text || '':obl;'')";
const LOWER_PLAIN = LOWER.replace(/''/g, "'");
const UPPER_PLAIN = UPPER.replace(/''/g, "'");

/** The per-obligation LIKE join, the shape that cannot use an index. */
const PER_ROW_LIKE_JOIN =
  /JOIN\s+public\.wallet_credit_idempotency\s+k\s+ON\s+k\.key\s+LIKE\s+'tourney:'\s*\|\|\s*p_tournament_id::text\s*\|\|\s*':obl:'\s*\|\|\s*o\.id::text/i;

const redefines = (sql: string) =>
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_settle_tournament_places\s*\(/i.test(sql);

describe('the place-evidence guard uses the key index', () => {
  it('keeps the fixing migration on main', () => {
    expect(files).toContain(FIX);
  });

  it('bounds the per-obligation LIKE by the tournament prefix on both sides, keeping the LIKE', () => {
    const sql = read(FIX);
    expect(sql).toContain(LOWER);
    expect(sql).toContain(UPPER);
    // ';' is the byte after ':', so the range is exactly the prefix and the
    // LIKE still decides: the guard's answer cannot change.
    expect(sql).toContain("ON k.key LIKE ''tourney:'' || p_tournament_id::text || '':obl:'' || o.id::text || '':%''");
    expect(sql).toContain('wallet_credit_idempotency_key_pattern_idx');
    expect(sql).toContain('@live-proof:');
  });

  it('moves no money and is one guarded transaction', () => {
    const sql = read(FIX);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\./i);
    expect(sql).not.toMatch(/UPDATE\s+public\./i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain('expected exactly one place-evidence join to amend');
  });

  it('no later migration rewrites the cash authority with an unbounded per-obligation LIKE join', () => {
    for (const f of files.filter((x) => x > FIX)) {
      const sql = read(f);
      if (redefines(sql) && PER_ROW_LIKE_JOIN.test(sql)) {
        expect(sql, `${f} rewrites fn_settle_tournament_places without the key-index range`).toContain(LOWER_PLAIN);
        expect(sql, `${f} rewrites fn_settle_tournament_places without the key-index range`).toContain(UPPER_PLAIN);
      }
    }
  });

  it('the pattern detector recognises the unbounded shape the incident ran', () => {
    const before = `
      FROM public.tournament_obligations o
      JOIN public.wallet_credit_idempotency k
        ON k.key LIKE 'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%'
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'place'`;
    expect(PER_ROW_LIKE_JOIN.test(before)).toBe(true);
    expect(before.includes(LOWER_PLAIN)).toBe(false);
  });
});
