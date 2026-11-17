/**
 * A per-row wallet-credit key LIKE uses the key index (2026-11-17).
 *
 * Nightly 20K 10d3c9b3 could not settle because a guard matched
 * wallet_credit_idempotency keys with a LIKE pattern built from each
 * obligation row ('tourney:<t>:obl:' || o.id || ':%'). A pattern computed per
 * row can never use an index, so Postgres seq-scanned every wallet credit
 * (1.9M and growing) once per obligation: 19-29 s for one 94-place event.
 * 20261117085019 fixed fn_settle_tournament_places; 20261117183436 fixed the
 * same shape in fn_settle_tournament_final_table_deal (6 sites) and
 * fn_ca_verify_terminal_final_deal_batch (1 site): 28,791 ms -> 13 ms.
 *
 * This law generalises the fn_settle_tournament_places law to every function:
 * from FROM_VERSION on, any migration that writes a wallet_credit_idempotency
 * key LIKE whose pattern concatenates a row or loop column (alias.column,
 * anything except a p_ parameter) must bound that site with a byte-wise
 * prefix range (~>=~ / ~<~) on wallet_credit_idempotency_key_pattern_idx.
 * The LIKE itself stays: the range is a superset filter and cannot change an
 * answer. Older migrations are history; their live bodies are covered by the
 * fixing migrations' @live-proof lines.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const dir = 'supabase/migrations';
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');

const FROM_VERSION = '20261117183436';
const FIX = '20261117183436_per_row_obligation_key_like_joins_use_the_key_index.sql';

/** Collapse SQL doubled quotes so DO-block literals read like function bodies. */
const plain = (sql: string) => sql.replace(/''/g, "'");

/**
 * Every `<a>.key LIKE <pattern>` whose pattern concatenates `<b>.<col>` with
 * <b> not a function parameter. Returns the offending snippets that have no
 * `~>=~` range on the same key within the surrounding predicate window.
 */
export function unboundedPerRowKeyLikes(sql: string): string[] {
  const text = plain(sql);
  const out: string[] = [];
  const re = /\b(\w+)\.key\s+LIKE\s+((?:'[^']*'|\w+(?:\.\w+)?(?:::\w+)?|\s*\|\|\s*)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const pattern = m[2];
    const cols = [...pattern.matchAll(/\b(\w+)\.(\w+)/g)].map((c) => c[1]);
    const perRow = cols.some((alias) => !/^p_/i.test(alias));
    if (!perRow) continue;
    const window = text.slice(Math.max(0, m.index - 600), m.index + m[0].length + 600);
    const bounded = new RegExp(`\\b${m[1]}\\.key\\s+(?:OPERATOR\\(pg_catalog\\.~>=~\\)|~>=~)`).test(
      window
    );
    if (!bounded) out.push(m[0].trim());
  }
  return out;
}

const touchesWalletCredits = (sql: string) => /wallet_credit_idempotency/i.test(sql);

describe('a per-row wallet-credit key LIKE uses the key index', () => {
  it('keeps the fixing migration on main, guarded and money-free', () => {
    expect(files).toContain(FIX);
    const sql = read(FIX);
    expect(sql).toContain('wallet_credit_idempotency_key_pattern_idx');
    expect(sql).toContain("fn_settle_tournament_final_table_deal(uuid)'::regprocedure, 6");
    expect(sql).toContain("fn_ca_verify_terminal_final_deal_batch(uuid,boolean)'::regprocedure, 1");
    expect(sql).toContain('@live-proof:');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\./i);
    expect(sql).not.toMatch(/UPDATE\s+public\./i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('the fixing rewrite keeps the LIKE and adds both byte-wise bounds', () => {
    const sql = read(FIX);
    expect(sql).toContain(
      "k.key OPERATOR(pg_catalog.~>=~) ('tourney:' || p_tournament_id::text || ':obl:' || \\2.id::text || ':')"
    );
    expect(sql).toContain(
      "k.key OPERATOR(pg_catalog.~<~) ('tourney:' || p_tournament_id::text || ':obl:' || \\2.id::text || ';')"
    );
    expect(sql).toContain('AND \\1)');
  });

  it('detects the unbounded shapes the incident and the final-table deal ran (pre-fix bodies)', () => {
    const preFix = [
      `JOIN public.wallet_credit_idempotency k
         ON k.key LIKE 'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%'`,
      `JOIN public.wallet_credit_idempotency k
         ON k.key LIKE 'tourney:'||p_tournament_id::text||':obl:'||o.id::text||':%'`,
      `SELECT count(*) FROM public.wallet_credit_idempotency k
        WHERE k.key LIKE
              'tourney:' || p_tournament_id::text || ':obl:' || v_ob.id::text || ':%'`,
      `JOIN public.wallet_credit_idempotency k ON k.key LIKE 'mb:' || a.id::text || ':%'`,
    ];
    for (const body of preFix) expect(unboundedPerRowKeyLikes(body)).not.toHaveLength(0);
  });

  it('accepts the bounded shapes and parameter-only patterns', () => {
    const ok = [
      `JOIN public.wallet_credit_idempotency k
         ON (k.key OPERATOR(pg_catalog.~>=~) ('tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':')
         AND k.key OPERATOR(pg_catalog.~<~) ('tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ';')
         AND k.key LIKE 'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%')`,
      `ON k.key ~>=~ ('mb:' || a.id::text || ':') AND k.key ~<~ ('mb:' || a.id::text || ';')
         AND k.key LIKE 'mb:' || a.id::text || ':%'`,
      `WHERE k.key LIKE 'tourney:' || p_tournament_id::text || ':%'`,
    ];
    for (const body of ok) expect(unboundedPerRowKeyLikes(body)).toEqual([]);
  });

  it('no migration from the fix on writes an unbounded per-row wallet-credit key LIKE', () => {
    for (const f of files.filter((x) => x.slice(0, 14) >= FROM_VERSION && x !== FIX)) {
      const sql = read(f);
      if (!touchesWalletCredits(sql)) continue;
      expect(
        unboundedPerRowKeyLikes(sql),
        `${f} matches wallet credits per row without the key-index range`
      ).toEqual([]);
    }
  });
});
