#!/usr/bin/env node
/**
 * Standalone Hold'em Blanket Rule Removal & Priced Replacement Program Scoreboard CLI (read-only).
 *
 * Inspects local source/docs (HorseOptionSwitch.ts, HorseLogic.ts, docs/horse-default-on.d/*.md,
 * docs/horse-option-authority.d/*.md) and executes a single batched read-only Supabase query across:
 *   - public.ca_horse_style_switch
 *   - public.ca_horse_option_registry_serving
 *   - public.ca_engine_runtime_settings_active (+ versions)
 *   - public.ca_horse_option_switch_evidence
 *   - public.horse_brain_telemetry (last N UTC days, default 3)
 *
 * Security invariants:
 *   - Read-only SELECT/WITH queries ONLY via `supabase db query --linked -o json --agent=no`.
 *   - Auto-resolves linked Supabase workdir via `git rev-parse --git-common-dir`.
 *   - NEVER reads, sources, prints, or touches `.env` or database credentials.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_TELEMETRY_DAYS,
  NEXT_ACTIONS,
  assertReadOnlySql,
  buildHoldemBlanketScoreboard,
  buildScoreboardBatchSql,
  filterScoreboardRules,
  formatScoreboardMarkdown,
  parseAuthorityDoc,
  parseCliArgs,
  parseDefaultOnDoc,
  parseSupabaseJsonOutput,
  resolveLinkedSupabaseWorkdir,
} from './holdem-blanket-scoreboard-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

export const USAGE = `Usage: node scripts/ops/holdem-blanket-scoreboard.mjs [options]

Options:
  --json                        Emit machine-readable JSON output
  --action <NEXT_ACTION>        Filter rows to a specific next-action class (repeatable)
                                Values: ${NEXT_ACTIONS.join(', ')}
  --only-actionable             Hide HELD_PREFLOP_OR_OWNER and LIVE_PRICED_COMPLETE rows
  --telemetry-days <1..14>      Telemetry lookback window in UTC days (default: ${DEFAULT_TELEMETRY_DAYS})
  --offline                     Skip live Supabase query (inspect local source & docs only)
  --supabase-workdir <dir>      Override auto-resolved linked Supabase workdir
  -h, --help                    Show this help text
`;

function loadMarkdownDir(repoRoot, relDir, parser) {
  const absDir = join(repoRoot, relDir);
  const out = {};
  if (!existsSync(absDir)) return out;
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === 'README.md') continue;
    // Skip supplementary docs like `<option>.CONSTANTS.md` or `<option>.UNREGISTERED.md`.
    const stem = entry.name.slice(0, -3);
    if (stem.includes('.')) continue;
    const relPath = `${relDir}/${entry.name}`;
    const content = readFileSync(join(absDir, entry.name), 'utf8');
    out[stem] = parser(content, relPath);
  }
  return out;
}

export function loadLocalRepoInputs(repoRoot = REPO_ROOT) {
  const optionSwitchPath = join(repoRoot, 'server/src/engine/HorseOptionSwitch.ts');
  const dataLedgerPath = join(repoRoot, 'server/src/engine/HorseDataLedger.ts');
  const horseLogicPath = join(repoRoot, 'server/src/engine/HorseLogic.ts');
  const horseOptionSwitchSource = readFileSync(optionSwitchPath, 'utf8');
  const horseDataLedgerSource = existsSync(dataLedgerPath)
    ? readFileSync(dataLedgerPath, 'utf8')
    : '';
  const horseLogicSource = existsSync(horseLogicPath) ? readFileSync(horseLogicPath, 'utf8') : '';
  const defaultOnDocs = loadMarkdownDir(repoRoot, 'docs/horse-default-on.d', parseDefaultOnDoc);
  const authorityDocs = loadMarkdownDir(
    repoRoot,
    'docs/horse-option-authority.d',
    parseAuthorityDoc
  );
  return {
    horseOptionSwitchSource,
    horseDataLedgerSource,
    horseLogicSource,
    defaultOnDocs,
    authorityDocs,
  };
}

export function querySupabaseReadOnly(sql, { cwd = REPO_ROOT, supabaseWorkdir = null } = {}) {
  const safeSql = assertReadOnlySql(sql);
  const linkedWorkdir =
    supabaseWorkdir ??
    resolveLinkedSupabaseWorkdir({
      cwd,
      gitCommonDirRunner: (dir) =>
        execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: dir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5_000,
        }),
    });

  const args = ['db', 'query', '--linked', '-o', 'json', '--agent=no'];
  if (linkedWorkdir) {
    args.push('--workdir', linkedWorkdir);
  }
  args.push(safeSql);

  const res = spawnSync('supabase', args, {
    cwd: linkedWorkdir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 45_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || `exit code ${String(res.status)}`).trim();
    throw new Error(`Supabase query failed: ${detail}`);
  }
  return parseSupabaseJsonOutput(res.stdout);
}

export async function runCli(argv, injectedDeps = {}) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    const stderr = injectedDeps.stderr ?? ((msg) => process.stderr.write(`${msg}\n`));
    stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return { exitCode: 2, data: null };
  }

  const stdout = injectedDeps.stdout ?? ((msg) => process.stdout.write(`${msg}\n`));
  if (options.help) {
    stdout(USAGE);
    return { exitCode: 0, data: null };
  }

  const loadInputs = injectedDeps.loadLocalRepoInputs ?? (() => loadLocalRepoInputs(REPO_ROOT));
  const localInputs = loadInputs();

  let dbSnapshot = null;
  if (!options.offline) {
    const queryFn =
      injectedDeps.querySupabase ??
      ((sql) =>
        querySupabaseReadOnly(sql, {
          cwd: REPO_ROOT,
          supabaseWorkdir: options.supabaseWorkdir,
        }));
    const sql = buildScoreboardBatchSql({ telemetryDays: options.telemetryDays });
    const rows = await queryFn(sql);
    const first = Array.isArray(rows) ? rows[0] : rows;
    dbSnapshot = first?.snapshot ?? first ?? {};
  }

  const now = injectedDeps.now ? injectedDeps.now() : new Date();
  const report = buildHoldemBlanketScoreboard({
    ...localInputs,
    dbSnapshot,
    telemetryDays: options.telemetryDays,
    now,
  });

  const filteredRules = filterScoreboardRules(report, {
    actions: options.actions,
    onlyActionable: options.onlyActionable,
  });

  if (options.json) {
    const output =
      options.actions.length > 0 || options.onlyActionable
        ? { ...report, filteredRuleCount: filteredRules.length, rules: filteredRules }
        : report;
    stdout(JSON.stringify(output, null, 2));
  } else {
    stdout(
      formatScoreboardMarkdown(report, {
        actions: options.actions,
        onlyActionable: options.onlyActionable,
      })
    );
  }

  return { exitCode: 0, data: report };
}

const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
