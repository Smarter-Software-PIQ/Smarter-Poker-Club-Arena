/**
 * A PER-ROW LOOKUP ON CHIP_LEDGER CARRIES AN INDEXED ENTITY FILTER (2026-11-24).
 *
 * chip_ledger holds about 30 million rows (production, 2026-11-24). A LIKE whose
 * pattern is built from each outer row ('tourney:' || s.id::text || ':%') can
 * never use an index: Postgres seq-scans the ledger once per row. The same
 * shape on wallet_credit_idempotency stranded Nightly 20K 10d3c9b3 for 19-29 s
 * per event (#11180, #11199). Its idempotency_key index uses the database
 * collation (en_US), so a LIKE prefix cannot use it either; a byte-wise range
 * (~>=~ / ~<~) helps only on a text_pattern_ops or COLLATE "C" index.
 *
 * From FROM_VERSION on, every LIKE on a chip_ledger column whose pattern
 * concatenates a row or loop column (alias.column, anything but a p_ parameter)
 * must, in the same statement, either
 *   1. filter that chip_ledger alias by equality on an indexed entity column
 *      (the leading column of a chip_ledger btree index), or
 *   2. bound the same column with a byte-wise range when a migration creates a
 *      text_pattern_ops or COLLATE "C" index on it.
 * Older migrations are history: the #11199 audit (2026-11-17) found every
 * current site bounded by an indexed entity filter.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const dir = 'supabase/migrations';
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');

export const FROM_VERSION = '20261117183436';

/**
 * Leading columns of the chip_ledger btree indexes on production (2026-11-24).
 * Equality on any of them is a point or entity lookup through its index
 * (created_at: idx_chip_ledger_created_at, the exact-instant match of
 * 20261105130850).
 */
export const INDEXED_ENTITY_COLUMNS = [
  'id',
  'created_at',
  'chain_seq',
  'idempotency_key',
  'to_entity_id',
  'from_entity_id',
  'tournament_id',
  'settlement_id',
  'correlation_id',
  'club_id',
  'performed_by',
];

/** Collapse SQL doubled quotes so DO-block literals read like function bodies. */
const plain = (sql: string) => sql.replace(/''/g, "'");

/** Columns some migration indexes byte-wise (text_pattern_ops or COLLATE "C"). */
export function patternIndexedColumns(corpus: string[]): Set<string> {
  const out = new Set<string>();
  for (const sql of corpus)
    for (const m of plain(sql).matchAll(
      /CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*?\bON\s+(?:public\.)?chip_ledger\b[^;]*?\(([^;]*?)\)/gi
    ))
      for (const c of m[1].matchAll(
        /\b(\w+)\s+(?:COLLATE\s+"C"\s*)?(?:text_pattern_ops|COLLATE\s+"C")/gi
      ))
        out.add(c[1].toLowerCase());
  return out;
}

const KEYWORDS = new Set(
  'where on join left right inner full cross using set and or as natural lateral group order limit for returning'.split(
    ' '
  )
);

/** The statement around an offset: from the previous ';' to the next one, outside string literals. */
function statementAt(text: string, at: number): string {
  const masked = text.replace(/'[^']*'/g, (q) => `'${' '.repeat(q.length - 2)}'`);
  const start = masked.lastIndexOf(';', at) + 1;
  const end = masked.indexOf(';', at);
  return text.slice(start, end < 0 ? text.length : end);
}

/**
 * Every per-row LIKE on a chip_ledger alias's column that its statement does not
 * bound. Returns the offending snippets.
 */
export function unboundedChipLedgerRowLikes(
  sql: string,
  patternIndexed = new Set<string>()
): string[] {
  const text = plain(sql);
  const out: string[] = [];
  const re =
    /\b(\w+)\.(\w+)\s+(?:I?LIKE|~~\*?)\s+((?:'[^']*'|\w+(?:\.\w+)?(?:::\w+)?|\s*\|\|\s*|\(\s*|\s*\))+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, alias, col, pattern] = m;
    const stmt = statementAt(text, m.index);
    const aliases = [...stmt.matchAll(/\bchip_ledger\s+(?:AS\s+)?(\w+)/gi)]
      .map((a) => a[1])
      .filter((a) => !KEYWORDS.has(a.toLowerCase()));
    const onLedger = aliases.includes(alias) || alias.toLowerCase() === 'chip_ledger';
    if (!onLedger) continue;
    const perRow = [...pattern.replace(/'[^']*'/g, "''").matchAll(/\b(\w+)\.(\w+)/g)].some(
      (c) => !/^p_/i.test(c[1])
    );
    if (!perRow) continue;
    const cols = INDEXED_ENTITY_COLUMNS.join('|');
    const entity =
      new RegExp(`\\b${alias}\\.(?:${cols})\\s*(?:=|IN\\b|=\\s*ANY\\b)`, 'i').test(stmt) ||
      new RegExp(`=\\s*${alias}\\.(?:${cols})\\b`, 'i').test(stmt);
    const range =
      patternIndexed.has(col.toLowerCase()) &&
      new RegExp(`\\b${alias}\\.${col}\\s+(?:OPERATOR\\(pg_catalog\\.~>=~\\)|~>=~)`, 'i').test(
        stmt
      );
    if (!entity && !range) out.push(m[0].trim());
  }
  return out;
}

describe('a per-row lookup on chip_ledger carries an indexed entity filter', () => {
  const corpus = files.map(read);
  const patternIndexed = patternIndexedColumns(corpus);

  it('fails on a probe of the unbounded shape', () => {
    const probes = [
      `SELECT s.id, (SELECT sum(l.amount) FROM public.chip_ledger l
                        WHERE l.idempotency_key LIKE 'tourney:' || s.id::text || ':seat:%:pool_transfer')
         FROM public.tournaments s`,
      `UPDATE x SET n = (SELECT count(*) FROM chip_ledger cl
                          WHERE cl.idempotency_key LIKE 'double-pay-reversal:' || d.tournament_id::text || ':%')
         FROM doubles d`,
      `SELECT 1 FROM public.chip_ledger AS led WHERE led.to_label ILIKE v_row.label || '%'`,
    ];
    for (const body of probes) expect(unboundedChipLedgerRowLikes(body), body).not.toHaveLength(0);
  });

  it('accepts a per-row LIKE bounded by an indexed entity filter, and a parameter-only pattern', () => {
    const ok = [
      `SELECT (SELECT sum(l.amount) FROM public.chip_ledger l
                WHERE l.tournament_id = s.id
                  AND l.idempotency_key LIKE 'tourney:' || s.id::text || ':seat:%:pool_transfer')
         FROM public.tournaments s`,
      `SELECT count(*) FROM public.chip_ledger l
        WHERE l.from_entity_id = ANY (v_users) AND l.idempotency_key LIKE 'x:' || d.user_id::text || ':%'`,
      `SELECT count(*) FROM public.chip_ledger l WHERE l.idempotency_key LIKE 'tourney:' || p_tournament_id::text || ':%'`,
      `SELECT 1 FROM wallet_credit_idempotency k WHERE k.key LIKE 'mb:' || a.id::text || ':%'`,
    ];
    for (const body of ok) expect(unboundedChipLedgerRowLikes(body), body).toEqual([]);
  });

  it('accepts a byte-wise range only where a pattern index exists on that column', () => {
    const body = `SELECT 1 FROM public.chip_ledger l, public.tournaments s
      WHERE l.idempotency_key ~>=~ ('tourney:' || s.id::text || ':')
        AND l.idempotency_key ~<~ ('tourney:' || s.id::text || ';')
        AND l.idempotency_key LIKE 'tourney:' || s.id::text || ':%'`;
    expect(unboundedChipLedgerRowLikes(body, new Set())).not.toHaveLength(0);
    expect(unboundedChipLedgerRowLikes(body, new Set(['idempotency_key']))).toEqual([]);
    expect(
      patternIndexedColumns([
        'CREATE INDEX chip_ledger_key_pattern ON public.chip_ledger USING btree (idempotency_key text_pattern_ops);',
      ])
    ).toEqual(new Set(['idempotency_key']));
  });

  it('no migration from FROM_VERSION on writes an unbounded per-row chip_ledger LIKE', () => {
    for (const f of files.filter((x) => x.slice(0, 14) >= FROM_VERSION)) {
      const sql = read(f);
      if (!/chip_ledger/i.test(sql)) continue;
      expect(
        unboundedChipLedgerRowLikes(sql, patternIndexed),
        `${f} matches chip_ledger rows per outer row without an indexed entity filter`
      ).toEqual([]);
    }
  });
});
