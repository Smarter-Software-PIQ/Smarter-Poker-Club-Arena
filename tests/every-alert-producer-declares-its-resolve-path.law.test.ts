import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * EVERY ALERT PRODUCER DECLARES ITS RESOLVE PATH (2026-11-24, incident fix audit).
 *
 * On 2026-11-17 four producers could fire and never resolve, so their
 * Reliability Controller incidents could never clear: sp-daily-digest and
 * sp-critical-pager (#11197), owner-operational-notifications (#11221) and
 * ca-stall-watch for a finished tournament (#11220). Each was found only after
 * it paged. This law makes the class a build failure:
 *   1. every literal source recorded through fn_record_operational_alert(s), or
 *      inserted into operational_alert_events, is declared in
 *      docs/reliability-controller/alert-producer-resolution.json;
 *   2. a declared kind is one of in-function, twin-event, mirror, informational
 *      or pending, and a pending source names an owner and a hard date after
 *      which this law fails;
 *   3. an in-function source names a resolver that a migration defines next to
 *      that source and a 'resolved' status.
 */
const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'supabase', 'migrations');
const REGISTRY = join(ROOT, 'docs', 'reliability-controller', 'alert-producer-resolution.json');
const KINDS = new Set(['in-function', 'twin-event', 'mirror', 'informational', 'pending']);

type Entry = { kind: string; resolvers?: string[]; owner?: string; until?: string; via?: string };
const registry: Record<string, Entry> = JSON.parse(readFileSync(REGISTRY, 'utf8')).sources;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

const SOURCE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
export function literalSources(sql: string): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(/fn_record_operational_alerts?\s*\(\s*'([^']+)'/gi)) out.add(m[1]);
  for (const m of sql.matchAll(
    /insert\s+into\s+(?:public\.)?operational_alert_events\s*\(\s*source\b[^)]*\)\s*values\s*\(\s*'([^']+)'/gi
  ))
    out.add(m[1]);
  return [...out].filter((s) => SOURCE.test(s));
}

/** The resolver is proved when one migration names it, the source and a resolved status. */
export function resolverProved(source: string, resolver: string, corpus: string[]): boolean {
  return corpus.some(
    (sql) =>
      sql.includes(resolver) &&
      sql.includes(`'${source}'`) &&
      /status\s*(?:=|:=)\s*'resolved'|'resolved'/i.test(sql)
  );
}

describe('every alert producer declares its resolve path', () => {
  const corpus = files.map(read);

  it('declares every source the migrations record', () => {
    const missing = new Set<string>();
    corpus.forEach((sql) => literalSources(sql).forEach((s) => registry[s] || missing.add(s)));
    expect(
      [...missing],
      'add each to alert-producer-resolution.json with its resolve path'
    ).toEqual([]);
  });

  it('declares a known kind, and a pending source has an owner and an unexpired date', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [source, e] of Object.entries(registry)) {
      expect(KINDS.has(e.kind), `${source}: unknown kind ${e.kind}`).toBe(true);
      if (e.kind === 'pending') {
        expect(e.owner && e.until, `${source}: pending needs owner and until`).toBeTruthy();
        expect(today <= String(e.until), `${source}: its resolve path was due ${e.until}`).toBe(
          true
        );
      }
      if (e.kind === 'twin-event' || e.kind === 'mirror')
        expect(e.via, `${source}: say how`).toBeTruthy();
    }
  });

  it('proves every in-function resolver in the migrations', () => {
    for (const [source, e] of Object.entries(registry)) {
      if (e.kind !== 'in-function') continue;
      expect(e.resolvers?.length, `${source}: name its resolver`).toBeTruthy();
      expect(
        e.resolvers!.some((r) => resolverProved(source, r, corpus)),
        `${source}: no migration defines ${e.resolvers} resolving it`
      ).toBe(true);
    }
  });

  it('would have failed on the shape that stranded the stuck-tournament pager (before #11197)', () => {
    const before = files.filter((f) => f < '20261117173255').map(read);
    expect(resolverProved('sp-critical-pager', 'fn_sp_critical_scan', before)).toBe(false);
    expect(resolverProved('sp-critical-pager', 'fn_sp_critical_scan', corpus)).toBe(true);
  });
});
