/**
 * V31 HUMAN REPLAY CLI (2026-11-07). Offline measurement, never a gate.
 *
 *   # 1. read-only fetch (repo root)
 *   node scripts/horse-measure/v31-human-replay-fetch.mjs cells --dataset=<uuid> --out=<data>
 *   node scripts/horse-measure/v31-human-replay-fetch.mjs hands --since=<iso> --until=<iso> --out=<data>/hands
 *   # 2. replay (server/, worker thread)
 *   EQUITY_GOVERNOR=off SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=offline \
 *   SUPABASE_ANON_KEY=offline node scripts/gto-v31-human-replay-worker.mjs \
 *     --dataset=<uuid> --cells=<data>/cells.json --hands=<data>/hands --out=<report dir> \
 *     [--exclude-users=<uuid,uuid>] [--limit-hands=N]
 *
 * Installs the sealed rows into the isolated, checksum-addressed evaluation
 * store with the engine's own seal validation (replaceGtoPostflopV31Evaluation,
 * or replaceGtoPostflopV31Recheck for an active dataset); the live store is
 * never touched and nothing is written anywhere but --out. Every postflop
 * horse decision of every hand is replayed through HorseLogic.decide with the
 * dataset selected (GtoV31HumanReplay.ts), then summarized.
 *
 * Writes <out>/v31-human-replay-<dataset>.json (report), .md (short report)
 * and decisions-<dataset>.jsonl (every decision with its status, playbook
 * receipt and the action actually taken).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

import { equityGovernor } from '../engine/EquityLoadGovernor.js';
import {
  gtoPostflopV31EvaluationCount,
  gtoV31FeatureContractVersion,
  gtoV31PolicyContractValid,
  replaceGtoPostflopV31Evaluation,
  replaceGtoPostflopV31Recheck,
  type GtoV31RuntimeRow,
} from '../engine/GtoPostflopV31.js';
import { parseExtract, type ExtractedHand } from '../engine/HorseComplaintReplay.js';
import {
  gtoV31HumanSpecIndex,
  renderGtoV31HumanReplayMarkdown,
  replayGtoV31HumanHand,
  summarizeGtoV31HumanReplay,
  type GtoV31HumanDecision,
} from '../benchmark/GtoV31HumanReplay.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function arg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** The same admission GtoPostflopV31Loader.readV31CellPage applies to an RPC page. */
function admitRows(raw: unknown, datasetId: string): GtoV31RuntimeRow[] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error('cells file is not a non-empty array');
  return raw.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new Error('v31_cell_page_row_invalid');
    if (row.dataset_id !== datasetId) throw new Error('v31_evaluation_dataset_mismatch');
    if (row.feature_contract_version !== null && gtoV31FeatureContractVersion(row) === null)
      throw new Error('v31_feature_contract_unknown');
    if (row.policy_export_schema !== null && !gtoV31PolicyContractValid(row))
      throw new Error('v31_policy_contract_unknown');
    const admitted = { ...row };
    if (row.feature_contract_version === null) delete admitted.feature_contract_version;
    if (row.policy_export_schema === null) delete admitted.policy_export_schema;
    return admitted as GtoV31RuntimeRow;
  });
}

function readHands(path: string): { hands: ExtractedHand[]; files: Record<string, string> } {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => /^hands-\d+\.json$/.test(f))
        .sort()
        .map((f) => join(path, f))
    : [path];
  const byId = new Map<string, ExtractedHand>();
  const receipts: Record<string, string> = {};
  for (const file of files) {
    const bytes = readFileSync(file);
    receipts[file] = sha256(bytes);
    const rows = JSON.parse(bytes.toString('utf8')) as unknown[];
    for (const row of rows) {
      const hand = parseExtract(row);
      byId.set(hand.handId, hand);
    }
  }
  return { hands: [...byId.values()], files: receipts };
}

function engineCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (isMainThread)
    throw new Error(
      'run through scripts/gto-v31-human-replay-worker.mjs (public215 cells answer only in a worker)'
    );
  if (equityGovernor.snapshot().enabled) throw new Error('run the replay with EQUITY_GOVERNOR=off');
  const datasetId = arg('dataset');
  const cellsPath = arg('cells');
  const handsPath = arg('hands');
  const out = arg('out');
  const limit = Number(arg('limit-hands', '0'));
  const excluded = new Set(
    arg('exclude-users')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (!UUID.test(datasetId)) throw new Error('--dataset=<uuid> is required');
  if (!cellsPath || !handsPath || !out) throw new Error('--cells, --hands and --out are required');
  for (const id of excluded)
    if (!UUID.test(id)) throw new Error(`--exclude-users: ${id} is not a uuid`);

  const cellBytes = readFileSync(cellsPath);
  const rows = admitRows(JSON.parse(cellBytes.toString('utf8')), datasetId);
  const checksum = rows[0].dataset_checksum;
  const state = rows[0].dataset_state;
  if (rows.some((r) => r.dataset_checksum !== checksum))
    throw new Error('dataset checksum is inconsistent');
  if (rows.length !== Number(rows[0].dataset_cells))
    throw new Error(`cells file holds ${rows.length} of ${rows[0].dataset_cells} sealed cells`);
  // Isolated evaluation store, selected only by checksum: never the live store.
  const installed =
    state === 'active' ? replaceGtoPostflopV31Recheck(rows) : replaceGtoPostflopV31Evaluation(rows);
  if (installed !== rows.length || gtoPostflopV31EvaluationCount(checksum) !== rows.length)
    throw new Error(`installed ${installed} of ${rows.length} cells`);
  const specs = gtoV31HumanSpecIndex(rows as never);
  console.log(
    `[v31-human-replay] ${installed} sealed cells of ${datasetId} (${checksum.slice(0, 12)}, ${state})`
  );

  const { hands: all, files } = readHands(handsPath);
  const hands = limit > 0 ? all.slice(0, limit) : all;
  const decisions: GtoV31HumanDecision[] = [];
  const t0 = Date.now();
  for (const [i, hand] of hands.entries()) {
    decisions.push(...replayGtoV31HumanHand(hand, checksum, specs, excluded));
    if ((i + 1) % 500 === 0) {
      const covered = decisions.filter((d) => d.status === 'covered').length;
      console.log(
        `[v31-human-replay] ${i + 1}/${hands.length} hands, ${decisions.length} decisions, ${covered} covered, ${Math.round((Date.now() - t0) / 1000)}s`
      );
    }
  }
  const report = summarizeGtoV31HumanReplay({
    decisions,
    hands: hands.length,
    datasetCellIds: [...specs.keys()],
    dataset: { id: datasetId, checksum, cells: rows.length, state },
    inputs: {
      cellsFile: cellsPath,
      cellsSha256: sha256(cellBytes),
      handFiles: files,
      handsRead: all.length,
      limitHands: limit || null,
      excludedUserIds: [...excluded].sort(),
      engineCommit: engineCommit(),
      runtimeMs: Date.now() - t0,
    },
  });
  mkdirSync(out, { recursive: true });
  const tag = datasetId.slice(0, 8);
  writeFileSync(join(out, `v31-human-replay-${tag}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, `v31-human-replay-${tag}.md`), renderGtoV31HumanReplayMarkdown(report));
  writeFileSync(
    join(out, `decisions-${tag}.jsonl`),
    decisions.map((d) => JSON.stringify(d)).join('\n') + (decisions.length ? '\n' : '')
  );
  console.log(
    `[v31-human-replay] done: ${decisions.length} decisions, ${report.census.byStatus.covered} covered, ` +
      `${report.vsHuman.decisions} vs a person; agreement ${report.vsHuman.agreementRate}; EV delta sum ${report.vsHuman.evDeltaSumBb} bb`
  );
}

await main();
