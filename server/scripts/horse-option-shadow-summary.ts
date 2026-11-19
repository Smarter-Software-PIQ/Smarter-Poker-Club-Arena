/**
 * OPTION SHADOW SUMMARY, from a read-only copy of the decision journal (2026-11-18).
 *
 *   npx tsx scripts/horse-option-shadow-summary.ts <journal copy .ndjson> [--option <name>]
 *        [--since <iso>] [--until <iso>]
 *
 * Prints one JSON object: per option in shadow, the decisions re-decided, how many the flipped option would have
 * changed (action or amount) and how, split person-present (a seat that is not a Horse was dealt in) vs Horse-only,
 * by street and variant. Counts only: no table, hand, seat or player id is printed. Reads the file as a stream and
 * writes nothing. Without a journal copy, the daily counters answer the same split per day:
 * scripts/sql/horse-option-shadow-summary.sql (run read-only).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { summariseOptionShadow } from '../src/engine/HorseOptionShadowSummary.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}
function time(name: string): number | null {
  const v = arg(name);
  if (v === null) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) {
    console.error(`${name} ${v} is not a time`);
    process.exit(2);
  }
  return t;
}

async function* rows(path: string): AsyncGenerator<unknown> {
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let n = 0;
  for await (const line of lines) {
    n++;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      console.error(`line ${n} is not JSON: stopped`);
      process.exit(1);
    }
  }
}

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error(
    'usage: npx tsx scripts/horse-option-shadow-summary.ts <journal copy .ndjson> [--option <name>] [--since <iso>] [--until <iso>]'
  );
  process.exit(2);
}
const collected: unknown[] = [];
const sinceMs = time('--since');
const untilMs = time('--until');
const option = arg('--option');
// The summary keeps counts only, so the rows are handed over in bounded batches.
let total: ReturnType<typeof summariseOptionShadow> | null = null;
const merge = (
  a: ReturnType<typeof summariseOptionShadow>,
  b: ReturnType<typeof summariseOptionShadow>
) => {
  a.recordsRead += b.recordsRead;
  a.decisionsWithReceipt += b.decisionsWithReceipt;
  for (const [name, slot] of Object.entries(b.options)) {
    const into = (a.options[name] ??= slot);
    if (into === slot) continue;
    for (const side of ['person', 'horseOnly'] as const) {
      const x = into[side];
      const y = slot[side];
      x.decisions += y.decisions;
      x.changed += y.changed;
      x.same += y.same;
      x.unknown += y.unknown;
      for (const key of ['changes', 'changedByStreet', 'changedByVariant'] as const)
        for (const [k, v] of Object.entries(y[key])) x[key][k] = (x[key][k] ?? 0) + v;
    }
  }
  return a;
};
for await (const row of rows(file)) {
  collected.push(row);
  if (collected.length >= 5_000) {
    const part = summariseOptionShadow(collected.splice(0), { sinceMs, untilMs, option });
    total = total ? merge(total, part) : part;
  }
}
const part = summariseOptionShadow(collected.splice(0), { sinceMs, untilMs, option });
total = total ? merge(total, part) : part;
console.log(JSON.stringify(total, null, 2));
