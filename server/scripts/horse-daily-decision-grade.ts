/**
 * HORSE DAILY DECISION GRADE - the daily real-card report of where Horses lose
 * chips to people. Read-only: bounded SELECTs, no write, no RPC, no schedule.
 *
 *     # print the statements (run them through any read-only SQL path)
 *     npx tsx scripts/horse-daily-decision-grade.ts --sql [--since T] [--until T]
 *
 *     # run them through the Supabase management API with read_only: true
 *     # (SUPABASE_ACCESS_TOKEN in the environment; SUPABASE_PROJECT_REF optional),
 *     # the read-only path scripts/ops/cash-room-realism-report.mjs --api uses
 *     npx tsx scripts/horse-daily-decision-grade.ts --api [--since T] [--until T] \
 *         --out /path/REPORT-2026-11-20.md [--previous /path/REPORT-2026-11-19.json]
 *
 *     # grade result files saved elsewhere: hands*.json (one result per slice),
 *     # an optional switch.json and an optional excluded.json (the per-variant
 *     # count of hands left out, PLO8 and the rest), each the JSON rows returned
 *     npx tsx scripts/horse-daily-decision-grade.ts --from-json <dir> --since T --until T --out ...
 *
 * --range-grade adds the public-information range grade as its own section (criteria:
 * hd-01Gw7aDs/range-grade/CRITERIA.md): every decision priced against ranges built from
 * the public action line, validated against real cards where the read-only route knows
 * them. The real-card sections are unchanged. --range-draws N (default 1500).
 *
 * --since / --until take an explicit offset (…Z) or a bare Chicago wall time
 * (2026-11-20T13:12). Default window: the last 24 hours. --slice-minutes
 * (default 15) bounds each hands statement. --out writes the markdown and, next
 * to it, <name>.json (aggregates only: no hole card and no hand id); with no
 * --previous the newest earlier REPORT-*.json in the same directory is the
 * comparison. Without --out the markdown is printed.
 *
 * The arithmetic and the owner rule on people's cards live in
 * src/benchmark/HorseDailyDecisionGrade.ts (pure, unit-tested); this file only
 * fetches. It holds no credential and prints none.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { rowsFromResultText } from '../src/engine/HorseComplaintReplay.js';
import {
  buildReport,
  chicagoStamp,
  compareReports,
  parseInstant,
  renderExcludedSql,
  renderHandsSql,
  renderMarkdown,
  renderSwitchSql,
  timeSlices,
  utcIso,
  REPORT_SCHEMA,
  type RawHand,
  type Report,
  type SwitchAudit,
  type SwitchRow,
} from '../src/benchmark/HorseDailyDecisionGrade.js';
import { insuranceEquity } from '../src/engine/InsuranceEquity.js';

/**
 * The private table holding every Horse's dealt cards (#11511). This CLI is the
 * only reader the law tests/horse-dealt-hole-cards-stay-private.law.test.ts
 * admits: an offline audit run by an operator through the read-only management
 * route (read_only: true), printing aggregates only (no card, no hand id).
 */
const HORSE_CARDS_TABLE = 'smarter_private.horse_dealt_hole_cards';

const DEFAULT_PROJECT_REF = 'kuklfnapbkmacvwxktbh';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}
const has = (name: string) => process.argv.includes(name);

async function query(sql: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  const ref = process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
  if (!token || !/^[a-z0-9]{20}$/.test(ref))
    throw new Error(
      'SUPABASE_ACCESS_TOKEN (and a valid SUPABASE_PROJECT_REF) are required for --api'
    );
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) throw new Error(`the read-only query answered HTTP ${res.status}`);
  return rowsFromResultText(await res.text());
}

/** One slice; a slice that fails is read once more as two halves, then the run stops. */
async function handsFor(start: string, end: string, split = true): Promise<RawHand[]> {
  try {
    return (await query(renderHandsSql(start, end, HORSE_CARDS_TABLE))) as RawHand[];
  } catch (e) {
    const a = Date.parse(start);
    const b = Date.parse(end);
    if (!split || b - a < 120_000) throw e;
    const mid = utcIso(a + Math.floor((b - a) / 2000) * 1000);
    return [...(await handsFor(start, mid, false)), ...(await handsFor(mid, end, false))];
  }
}

function previousReport(
  out: string | undefined,
  explicit: string | undefined
): { report: Report; label: string } | null {
  let path = explicit;
  if (!path && out) {
    const dir = dirname(out);
    const mine = basename(out).replace(/\.md$/, '.json');
    const earlier = readdirSync(dir)
      .filter((f) => /^REPORT-.*\.json$/.test(f) && f < mine)
      .sort();
    if (earlier.length) path = join(dir, earlier[earlier.length - 1]);
  }
  if (!path || !existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, 'utf8')) as Report;
  if (report.schema !== REPORT_SCHEMA) throw new Error(`${path} is not a ${REPORT_SCHEMA} report`);
  return {
    report,
    label: `${basename(path)} (${chicagoStamp(Date.parse(report.start))} to ${chicagoStamp(Date.parse(report.end))})`,
  };
}

async function main(): Promise<void> {
  const now = Date.now();
  const endMs = arg('--until') ? parseInstant(arg('--until')!) : now;
  const startMs = arg('--since') ? parseInstant(arg('--since')!) : endMs - 86_400_000;
  const minutes = Number(arg('--slice-minutes') ?? 15);
  const slices = timeSlices(startMs, endMs, minutes);
  const out = arg('--out');
  if (out && !out.endsWith('.md')) throw new Error('--out must end in .md');

  if (has('--sql')) {
    for (const [a, b] of slices) console.log(renderHandsSql(a, b, HORSE_CARDS_TABLE) + ';\n');
    console.log(renderExcludedSql(utcIso(startMs), utcIso(endMs)) + ';\n');
    console.log(renderSwitchSql(utcIso(startMs)) + ';');
    return;
  }

  let hands: RawHand[] = [];
  let switchRows: SwitchRow[] | null = null;
  let switchAudit: SwitchAudit[] | null = null;
  let excluded: Array<{ g: string; n: number }> | null = null;
  const takeSwitch = (rows: unknown[]) => {
    const row = (rows[0] ?? {}) as { rows?: SwitchRow[] | null; audit?: SwitchAudit[] | null };
    switchRows = row.rows ?? [];
    switchAudit = row.audit ?? [];
  };
  const dir = arg('--from-json');
  if (dir) {
    for (const f of readdirSync(dir).sort()) {
      if (/^hands.*\.json$/.test(f))
        hands = hands.concat(rowsFromResultText(readFileSync(join(dir, f), 'utf8')) as RawHand[]);
      else if (f === 'switch.json')
        takeSwitch(rowsFromResultText(readFileSync(join(dir, f), 'utf8')));
      else if (f === 'excluded.json')
        excluded = rowsFromResultText(readFileSync(join(dir, f), 'utf8')) as Array<{
          g: string;
          n: number;
        }>;
    }
  } else if (has('--api')) {
    for (const [a, b] of slices) {
      const rows = await handsFor(a, b);
      hands = hands.concat(rows);
      console.error(`${chicagoStamp(Date.parse(a))}: ${rows.length} hands`);
    }
    excluded = (await query(renderExcludedSql(utcIso(startMs), utcIso(endMs)))) as Array<{
      g: string;
      n: number;
    }>;
    takeSwitch(await query(renderSwitchSql(utcIso(startMs))));
  } else {
    throw new Error('choose one of --sql, --api or --from-json <dir>');
  }

  const command =
    'npx tsx scripts/horse-daily-decision-grade.ts ' +
    process.argv
      .slice(2)
      .map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a}'`))
      .join(' ');
  const report = buildReport({
    command,
    startMs,
    endMs,
    hands,
    switchRows,
    switchAudit,
    excluded,
    equity: insuranceEquity,
    rangeGrade: has('--range-grade'),
    rangeDraws: arg('--range-draws') ? Number(arg('--range-draws')) : undefined,
  });
  const previous = previousReport(out, arg('--previous'));
  const markdown = renderMarkdown(
    report,
    previous ? compareReports(previous.report, report) : null,
    previous?.label ?? null
  );
  if (!out) {
    console.log(markdown);
    return;
  }
  writeFileSync(out, markdown);
  writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(report, null, 1) + '\n');
  console.error(`wrote ${out} and its .json (${report.hands} hands)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
