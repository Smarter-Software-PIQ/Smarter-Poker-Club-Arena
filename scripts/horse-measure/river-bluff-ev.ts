/**
 * River bluff live report (read-only, on demand). How the river bluffs of
 * #9803 / #9837 / #9838 / #9842 play at the live tables: fire counts per
 * layer, bet frequency when checked to, air share of bets, the fold rate the
 * bluffs get against the break-even of the size used, and their realized
 * chip EV with standard errors, against the 2026-11-07 pre-release baseline.
 * TUNING.md beside this file says how to turn the report into a tune.
 *
 * Nothing here writes anywhere or schedules anything. It renders read-only
 * statements; you run each one (Supabase MCP execute_sql, project
 * kuklfnapbkmacvwxktbh, or the management API) and save its raw result text
 * to a file; `assemble` reads the files.
 *
 * Usage (from server/, so the engine sources resolve):
 *   npx tsx ../scripts/horse-measure/river-bluff-ev.ts window [--first-fire-day DAY]
 *       default window: since the engine boot that first served 57d9c627.
 *       Exit 0 RELEASED (prints START END), 4 NOT_RELEASED, 3 UNKNOWN.
 *   npx tsx ../scripts/horse-measure/river-bluff-ev.ts plan START END [HOURS]
 *       every statement for the window as JSON [{id, file, sql}], spots in
 *       HOURS-hour slices (default 2) plus one receipts statement.
 *   npx tsx ../scripts/horse-measure/river-bluff-ev.ts sql spots START END
 *   npx tsx ../scripts/horse-measure/river-bluff-ev.ts sql receipts START_DAY END_DAY
 *   npx tsx ../scripts/horse-measure/river-bluff-ev.ts assemble START END FILE... [--json]
 *       FILE: saved results (spots slices and the receipts), in any order.
 * Timestamps need an explicit offset (2026-11-08T10:05:00Z).
 *
 * NEVER refer to the horses as "bots" - they are HORSES only.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RIVER_BLUFF_RELEASE_COMMIT,
  buildReport,
  chicagoReleaseInstant,
  parseReceiptsResult,
  parseSpotsResult,
  renderMarkdown,
  renderReceiptsSql,
  renderSpotsSql,
  resolveWindow,
  resultSection,
  slices,
  type ReceiptsResult,
  type SpotsSlice,
} from '../../server/src/benchmark/RiverBluffLiveReport.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPOTS = resolve(HERE, 'sql/river-bluff-spots.sql');
const RECEIPTS = resolve(HERE, 'sql/river-bluff-receipts.sql');
const HEALTH = 'https://engine.smarter.poker/health';

const day = (t: string) => new Date(Date.parse(t)).toISOString().slice(0, 10);

function containsCommit(releaseSha: string): boolean | null {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', RIVER_BLUFF_RELEASE_COMMIT, releaseSha], {
      stdio: 'ignore',
    });
    return true;
  } catch (e) {
    // exit 1 = not an ancestor; anything else (unknown object) = could not tell
    return (e as { status?: number }).status === 1 ? false : null;
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'window') {
    const i = rest.indexOf('--first-fire-day');
    const firstFire = i >= 0 ? rest[i + 1] : undefined;
    let health: unknown = null;
    try {
      const res = await fetch(HEALTH, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) health = await res.json();
    } catch {
      health = null;
    }
    const sha = (health as { releaseSha?: unknown } | null)?.releaseSha;
    const r = resolveWindow({
      health,
      containsCommit: typeof sha === 'string' ? containsCommit(sha) : null,
      now: new Date().toISOString(),
      firstBootStart: firstFire ? chicagoReleaseInstant(firstFire) : null,
    });
    console.log(JSON.stringify(r, null, 2));
    return r.status === 'RELEASED' ? 0 : r.status === 'NOT_RELEASED' ? 4 : 3;
  }
  if (cmd === 'sql') {
    const [which, a, b] = rest;
    if (which === 'spots') console.log(renderSpotsSql(readFileSync(SPOTS, 'utf8'), a, b));
    else if (which === 'receipts')
      console.log(renderReceiptsSql(readFileSync(RECEIPTS, 'utf8'), a, b));
    else throw new Error('sql spots START END | sql receipts START_DAY END_DAY');
    return 0;
  }
  if (cmd === 'plan') {
    const [start, end, hours] = rest;
    const spots = readFileSync(SPOTS, 'utf8');
    const plan = slices(start, end, hours ? Number(hours) : 2).map(([a, b], k) => ({
      id: `spots-${String(k).padStart(2, '0')}`,
      file: `spots-${String(k).padStart(2, '0')}.json`,
      window: [a, b],
      sql: renderSpotsSql(spots, a, b),
    }));
    const lastDay = day(new Date(Date.parse(end) - 1).toISOString());
    plan.push({
      id: 'receipts',
      file: 'receipts.json',
      window: [day(start), lastDay],
      sql: renderReceiptsSql(readFileSync(RECEIPTS, 'utf8'), day(start), lastDay),
    });
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  if (cmd === 'assemble') {
    const json = rest.includes('--json');
    const [start, end, ...files] = rest.filter((x) => x !== '--json');
    const parts: SpotsSlice[] = [];
    let receipts: ReceiptsResult | null = null;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const kind = resultSection(text);
      if (kind === 'spots') parts.push(parseSpotsResult(text));
      else if (kind === 'receipts') {
        if (receipts) throw new Error(`${f}: a second receipts result`);
        receipts = parseReceiptsResult(text);
      } else throw new Error(`${f}: neither a spots nor a receipts result`);
    }
    const report = buildReport({ window: [start, end], slices: parts, receipts });
    console.log(json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
    return report.coverage.complete && report.status === 'DATA' ? 0 : 3;
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
);
