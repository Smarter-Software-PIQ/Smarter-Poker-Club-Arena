#!/usr/bin/env node
/**
 * V31 human replay, step 1: fetch the inputs READ-ONLY.
 *
 *   node scripts/horse-measure/v31-human-replay-fetch.mjs cells --dataset=<uuid> --out=<dir>
 *   node scripts/horse-measure/v31-human-replay-fetch.mjs hands --since=<iso> --until=<iso> --out=<dir> [--page=300]
 *
 * Renders sql/v31-human-replay-cells.sql and sql/v31-human-replay-hands.sql
 * with literal values, refuses anything but one SELECT/WITH statement, and
 * sends it to the Supabase Management API query endpoint with
 * `read_only: true` (the project's own read-only transaction mode). Nothing is
 * ever written to the database. The token is the operator's
 * SUPABASE_ACCESS_TOKEN from the environment; nothing is read from .env files.
 *
 * Output (all under --out): cells.json (the RPC rows, the exact input
 * GtoPostflopV31Loader would feed replaceGtoPostflopV31Evaluation), hands-NNNN.json
 * (one array of complaint-extract-shaped hands per page) and a
 * fetch-receipt-<kind>.json with the rendered query hashes and row counts.
 * Step 2 is server/scripts/gto-v31-human-replay-worker.mjs.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const WRITE =
  /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|vacuum|analyze|refresh|lock|listen|notify|set|reset|comment|security|execute|prepare)\b/i;
const SIDE_EFFECT = /\b(pg_|lo_|dblink|nextval|setval|set_config)\w*\s*\(/i;

const arg = (name, fallback = '') =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

/** One SELECT/WITH statement, no write keyword, no side-effect function. */
export function readOnlyProblem(sql) {
  const body = sql
    .split('\n')
    .map((l) => l.split('--')[0])
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");
  if (/[$"]/.test(body)) return 'quoted identifier or dollar quote';
  if (WRITE.test(body)) return 'write keyword';
  if (SIDE_EFFECT.test(body)) return 'side-effect function';
  const statements = body
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length !== 1) return 'not exactly one statement';
  if (!/^(with|select)\b/i.test(statements[0])) return 'not a SELECT';
  if (/:[A-Z_]{3,}\b/.test(body)) return 'unresolved placeholder';
  return null;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function query(sql) {
  const problem = readOnlyProblem(sql);
  if (problem) throw new Error(`refusing to send the statement: ${problem}`);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const project = arg('project', 'kuklfnapbkmacvwxktbh');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    // A read is idempotent; a rate limit or gateway error is retried a few
    // times with backoff, anything else stops the fetch.
    if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(res.status))
      throw new Error(`query failed (${res.status}): ${text.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const template = (name) => readFileSync(join(HERE, 'sql', name), 'utf8');

async function fetchCells(out) {
  const dataset = arg('dataset');
  if (!UUID.test(dataset)) throw new Error('--dataset=<uuid> is required');
  const sql = template('v31-human-replay-cells.sql');
  const rows = [];
  const queries = [];
  const limit = 8;
  for (let offset = 0; ; offset += limit) {
    const rendered = sql
      .replaceAll(':DATASET', `'${dataset}'::uuid`)
      .replaceAll(':OFFSET', String(offset))
      .replaceAll(':LIMIT', String(limit));
    queries.push(sha256(rendered));
    const page = await query(rendered);
    rows.push(...page.map((r) => r.cell));
    console.log(`cells: ${rows.length}`);
    if (page.length < limit) break;
    if (offset > 100_000) throw new Error('cell paging did not terminate');
  }
  if (rows.length === 0)
    throw new Error(`dataset ${dataset} returned no cells (not sealed/evaluable?)`);
  const bytes = JSON.stringify(rows);
  writeFileSync(join(out, 'cells.json'), bytes);
  writeFileSync(
    join(out, 'fetch-receipt-cells.json'),
    JSON.stringify(
      {
        kind: 'cells',
        dataset,
        datasetChecksum: rows[0].dataset_checksum,
        datasetCells: rows[0].dataset_cells,
        rows: rows.length,
        fileSha256: sha256(bytes),
        querySha256: queries,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`cells: ${rows.length} rows for ${dataset}`);
}

async function fetchHands(out) {
  const since = arg('since');
  const until = arg('until');
  const limit = Number(arg('page', '300'));
  if (!ISO.test(since) || !ISO.test(until))
    throw new Error('--since and --until must be ISO timestamps');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000)
    throw new Error('--page must be 1..2000');
  const sql = template('v31-human-replay-hands.sql');
  let afterCreated = '1970-01-01T00:00:00Z';
  let afterId = '00000000-0000-0000-0000-000000000000';
  const pages = [];
  let hands = 0;
  for (let n = 0; ; n++) {
    const rendered = sql
      .replaceAll(':SINCE', `'${since}'::timestamptz`)
      .replaceAll(':UNTIL', `'${until}'::timestamptz`)
      .replaceAll(':AFTER_CREATED', `'${afterCreated}'::timestamptz`)
      .replaceAll(':AFTER_ID', `'${afterId}'::uuid`)
      .replaceAll(':LIMIT', String(limit));
    const rows = await query(rendered);
    if (rows.length === 0) break;
    const page = rows.map((r) => r.hand);
    const file = `hands-${String(n).padStart(4, '0')}.json`;
    const bytes = JSON.stringify(page);
    writeFileSync(join(out, file), bytes);
    pages.push({
      file,
      hands: page.length,
      querySha256: sha256(rendered),
      fileSha256: sha256(bytes),
    });
    hands += page.length;
    const last = page[page.length - 1];
    afterCreated = new Date(last.createdAt).toISOString().replace('Z', '') + '+00:00';
    // Keep the database's microseconds: Date drops them, the jsonb text keeps them.
    if (typeof last.createdAt === 'string' && ISO.test(last.createdAt.replace(' ', 'T')))
      afterCreated = last.createdAt.replace(' ', 'T');
    afterId = last.handId;
    console.log(`hands page ${n}: ${page.length} (total ${hands}) through ${afterCreated}`);
    if (page.length < limit) break;
  }
  writeFileSync(
    join(out, 'fetch-receipt-hands.json'),
    JSON.stringify(
      {
        kind: 'hands',
        since,
        until,
        page: limit,
        hands,
        pages,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

const kind = process.argv[2];
const out = arg('out');
if (!out) throw new Error('--out=<dir> is required');
mkdirSync(out, { recursive: true });
if (kind === 'cells') await fetchCells(out);
else if (kind === 'hands') await fetchHands(out);
else throw new Error('usage: v31-human-replay-fetch.mjs cells|hands ...');
