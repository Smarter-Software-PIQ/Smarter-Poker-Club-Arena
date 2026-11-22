#!/usr/bin/env node
// scripts/ops/horse-option-switch.mjs
// Production-hardened Horse option switch CLI.
//
// Security invariant:
// - Uses `supabase db query --linked -o json --agent=no` ONLY.
// - NEVER reads, sources, prints, or touches `.env` or service-role keys.
//
// Subcommands:
//   status
//   preflight <option> <targetState> [flags]
//   set <option> <targetState> --reason ... --authority ... [--evidence-sha ...] --changed-by ... [--log-file ...] [--dry-run]
//   verify-pickup <option> <expectedState> [--baseline <n>] [--min-workers <n>]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_MIN_PICKUP_WORKERS,
  EVIDENCE_REQUIRED_STATES,
  LEGAL_STATES,
  SHADOW_STATES,
  assertSafeOptionName,
  assertSafeState,
  buildEvidenceLookupSql,
  buildPickupTelemetrySql,
  buildReadbackSql,
  buildRegistryRefusalSql,
  buildStatusQueries,
  buildSwitchNote,
  buildSwitchSetSql,
  checkMaintenanceAndCutoverHold,
  evaluatePickup,
  evaluatePreflight,
  formatSwitchChangeLogLine,
  parseCliArgs,
  parseSupabaseQueryJson,
} from './horse-option-switch-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

export const USAGE = `Usage:
  node scripts/ops/horse-option-switch.mjs status [--json] [--health-url <url>] [--windows-file <path>] [--inbox-file <path>]
  node scripts/ops/horse-option-switch.mjs preflight <option> <off|shadow|on_shadow|on> [flags]
  node scripts/ops/horse-option-switch.mjs set <option> <off|shadow|on_shadow|on> --reason <text> --authority <ref> [--evidence-sha <64-hex>] --changed-by <actor> [--log-file <path>] [--dry-run] [--rollback] [--allow-window-override]
  node scripts/ops/horse-option-switch.mjs verify-pickup <option> <off|shadow|on_shadow|on> [--baseline <n>] [--min-workers <n>]

Legal states: ${LEGAL_STATES.join(', ')}
`;

export function resolveSupabaseWorkdir(explicitWorkdir = '', repoRoot = REPO_ROOT) {
  if (explicitWorkdir) return resolve(explicitWorkdir);
  if (process.env.SUPABASE_WORKDIR) return resolve(process.env.SUPABASE_WORKDIR);
  if (existsSync(resolve(repoRoot, 'supabase', '.temp', 'project-ref'))) {
    return repoRoot;
  }
  try {
    const commonDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
    if (commonDir) {
      const mainRepoRoot = dirname(resolve(repoRoot, commonDir));
      if (existsSync(resolve(mainRepoRoot, 'supabase', '.temp', 'project-ref'))) {
        return mainRepoRoot;
      }
    }
  } catch {
    // Fall back to repoRoot; supabase CLI will report a clear missing-link error.
  }
  return repoRoot;
}

export function defaultQueryDb(
  sql,
  { supabaseBin = 'supabase', cwd = REPO_ROOT, workdir = '' } = {}
) {
  const effectiveWorkdir = resolveSupabaseWorkdir(workdir, cwd);
  const args = ['db', 'query', '--linked', '-o', 'json', '--agent=no'];
  if (effectiveWorkdir) {
    args.push('--workdir', effectiveWorkdir);
  }
  args.push(sql);
  const stdout = execFileSync(supabaseBin, args, {
    cwd: effectiveWorkdir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  return parseSupabaseQueryJson(stdout);
}

export async function defaultFetchHealth(healthUrl) {
  if (!healthUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(healthUrl, {
      headers: { 'User-Agent': 'horse-option-switch-cli/2' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status} from ${healthUrl}` };
    }
    return await res.json();
  } catch (err) {
    return { error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function defaultReadFile(filePath) {
  const resolved = resolve(REPO_ROOT, filePath);
  return readFileSync(resolved, 'utf8');
}

export function defaultReadFileBuffer(filePath) {
  const resolved = resolve(REPO_ROOT, filePath);
  return readFileSync(resolved);
}

export function defaultAppendLogLine(logFile, line) {
  appendFileSync(logFile, `${line}\n`, 'utf8');
}

function loadOwnerWindows(windowsFile, readFile) {
  if (!windowsFile) return null;
  try {
    const resolved = resolve(REPO_ROOT, windowsFile);
    if (!existsSync(resolved) && readFile === defaultReadFile) return null;
    const raw = readFile(windowsFile);
    return JSON.parse(raw);
  } catch (err) {
    return {
      windows: [
        {
          id: 'unreadable-owner-maintenance-windows',
          notBefore: '1970-01-01T00:00:00Z',
          notAfter: '2999-12-31T23:59:59Z',
          error: err?.message || String(err),
        },
      ],
    };
  }
}

function loadInboxText(inboxFile, requireInbox, readFile) {
  if (!inboxFile) return undefined;
  try {
    return readFile(inboxFile);
  } catch {
    return requireInbox ? null : null;
  }
}

function loadDbMaintenance(queryDb) {
  const queries = buildStatusQueries();
  const metaRows = queryDb(queries.maintenanceState);
  const meta = metaRows[0] ?? {};
  const platformFrozen = meta.platform_frozen === true || meta.platform_frozen === 't';
  const hasBreak = meta.has_break_table === true || meta.has_break_table === 't';
  const hasWindows = meta.has_windows_table === true || meta.has_windows_table === 't';

  const breakRows = hasBreak ? queryDb(queries.maintenanceBreakRows) : [];
  const windowRows = hasWindows ? queryDb(queries.maintenanceWindowsRows) : [];
  return { platformFrozen, breakRows, windowRows };
}

function resolveEvidenceSha(flags, readFileBuffer) {
  if (flags.evidenceSha) return flags.evidenceSha.trim().toLowerCase();
  if (!flags.authority) return '';
  try {
    const resolved = resolve(REPO_ROOT, flags.authority);
    if (readFileBuffer === defaultReadFileBuffer && !existsSync(resolved)) return '';
    const buf = readFileBuffer(flags.authority);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return '';
  }
}

async function handleStatus(flags, deps) {
  const nowUtc = flags.now ? new Date(flags.now) : deps.now();
  const queries = buildStatusQueries();

  const switchRows = deps.queryDb(queries.switchRows);
  const recentAudit = deps.queryDb(queries.recentAudit);
  const servingRegistries = deps.queryDb(queries.servingRegistries);
  const dbMaintenance = loadDbMaintenance(deps.queryDb);
  const recentConfigAlarms = deps.queryDb(queries.recentConfigAlarms);
  const engineHealth = await deps.fetchHealth(flags.healthUrl);
  const ownerWindowsConfig = loadOwnerWindows(flags.windowsFile, deps.readFile);
  const inboxText = loadInboxText(flags.inboxFile, flags.requireInbox, deps.readFile);

  const maintenanceHold = checkMaintenanceAndCutoverHold({
    nowUtc,
    dbMaintenance,
    ownerWindowsConfig,
    engineHealth,
    inboxText,
    requireInbox: flags.requireInbox,
  });

  const activeShadow = switchRows.filter((r) => SHADOW_STATES.includes(r.state));
  const summary = {
    timestampUtc: nowUtc.toISOString(),
    servingReleases: servingRegistries.map((r) => ({
      releaseSha: r.release_sha,
      seenAt: r.seen_at,
      optionCount: r.registry ? Object.keys(r.registry).length : 0,
    })),
    engineHealth: engineHealth
      ? {
          status: engineHealth.status ?? null,
          liveness: engineHealth.liveness ?? null,
          releaseSha: engineHealth.releaseSha ?? null,
          maintenanceActive: engineHealth.maintenance?.active ?? null,
          maintenancePhase: engineHealth.maintenance?.phase ?? null,
          decisionPhase: engineHealth.liveHorseDecision?.phase ?? null,
          error: engineHealth.error ?? null,
        }
      : null,
    maintenanceHold: {
      held: !maintenanceHold.ok,
      holds: maintenanceHold.holds ?? [],
    },
    switchRowCount: switchRows.length,
    activeShadow,
    recentConfigAlarms,
    recentAudit: recentAudit.slice(0, 10),
    switchRows,
  };

  if (flags.json) {
    deps.stdout(JSON.stringify(summary, null, 2));
    return { exitCode: 0, data: summary };
  }

  const lines = [
    `== HORSE OPTION SWITCH STATUS (${summary.timestampUtc})`,
    `   serving registries (fresh <=5m): ${
      summary.servingReleases.length > 0
        ? summary.servingReleases
            .map((r) => `${r.releaseSha.slice(0, 12)} (${r.optionCount} options, seen ${r.seenAt})`)
            .join(', ')
        : 'NONE (fail-closed)'
    }`,
    `   engine /health: ${
      summary.engineHealth?.error
        ? `ERROR ${summary.engineHealth.error}`
        : `sha=${String(summary.engineHealth?.releaseSha || '?').slice(0, 12)} status=${summary.engineHealth?.status} maintenance=${summary.engineHealth?.maintenancePhase} decision=${summary.engineHealth?.decisionPhase}`
    }`,
    `   maintenance/cutover hold: ${
      summary.maintenanceHold.held ? `HELD (${summary.maintenanceHold.holds.join('; ')})` : 'clear'
    }`,
    `   switch rows: ${summary.switchRowCount} total; active shadow/on_shadow: ${
      activeShadow.length > 0
        ? activeShadow.map((r) => `${r.option}=${r.state}`).join(', ')
        : 'none (0)'
    }`,
    `   recent config alarms: ${
      recentConfigAlarms.length > 0
        ? recentConfigAlarms.map((a) => `${a.feature}=${a.fires}`).join(', ')
        : 'none (0)'
    }`,
    '   last 5 audit rows:',
    ...recentAudit
      .slice(0, 5)
      .map(
        (a) =>
          `     #${a.id} ${a.changed_at} ${a.option}: ${a.old_state ?? 'default'} -> ${a.new_state} (${a.changed_by})`
      ),
  ];
  deps.stdout(lines.join('\n'));
  return { exitCode: 0, data: summary };
}

async function runPreflightCore(option, targetState, flags, deps) {
  const safeOpt = assertSafeOptionName(option);
  const safeState = assertSafeState(targetState);
  const nowUtc = flags.now ? new Date(flags.now) : deps.now();
  const queries = buildStatusQueries();

  const switchRows = deps.queryDb(queries.switchRows);
  const recentAudit = deps.queryDb(queries.recentAudit);
  const servingRegistries = deps.queryDb(queries.servingRegistries);
  const refusalRows = deps.queryDb(buildRegistryRefusalSql(safeOpt, safeState));
  const registryRefusal = refusalRows[0]?.refusal ?? null;
  const dbMaintenance = loadDbMaintenance(deps.queryDb);
  const recentConfigAlarms = deps.queryDb(queries.recentConfigAlarms);
  const engineHealth = await deps.fetchHealth(flags.healthUrl);
  const ownerWindowsConfig = loadOwnerWindows(flags.windowsFile, deps.readFile);
  const inboxText = loadInboxText(flags.inboxFile, flags.requireInbox, deps.readFile);

  const resolvedEvidenceSha = resolveEvidenceSha(flags, deps.readFileBuffer);
  let evidenceRecorded = null;
  if (EVIDENCE_REQUIRED_STATES.includes(safeState) && resolvedEvidenceSha) {
    const evRows = deps.queryDb(buildEvidenceLookupSql(safeOpt, resolvedEvidenceSha));
    evidenceRecorded = evRows.length > 0;
  }

  const result = evaluatePreflight({
    option: safeOpt,
    targetState: safeState,
    nowUtc,
    changedBy: flags.changedBy,
    lane: flags.lane,
    reason: flags.reason,
    authority: flags.authority,
    evidenceSha: resolvedEvidenceSha,
    isRollback: flags.rollback,
    allowWindowOverride: flags.allowWindowOverride,
    currentRows: switchRows,
    auditRows: recentAudit,
    servingRegistries,
    registryRefusal,
    evidenceRecorded,
    dbMaintenance,
    ownerWindowsConfig,
    engineHealth,
    inboxText,
    requireInbox: flags.requireInbox,
    recentConfigAlarms,
  });

  return {
    option: safeOpt,
    targetState: safeState,
    nowUtc,
    resolvedEvidenceSha,
    result,
  };
}

async function handlePreflight(positionals, flags, deps) {
  if (positionals.length < 2) {
    throw new Error('preflight requires <option> <targetState>');
  }
  const [option, targetState] = positionals;
  const { nowUtc, resolvedEvidenceSha, result } = await runPreflightCore(
    option,
    targetState,
    flags,
    deps
  );

  const payload = {
    command: 'preflight',
    option,
    targetState,
    timestampUtc: nowUtc.toISOString(),
    evidenceSha: resolvedEvidenceSha || null,
    ...result,
  };

  if (flags.json) {
    deps.stdout(JSON.stringify(payload, null, 2));
  } else {
    const lines = [
      `== PREFLIGHT ${option} -> ${targetState} (${nowUtc.toISOString()})`,
      `   current state: ${result.currentState ?? 'default (no row)'}`,
      ...result.warnings.map((w) => `   WARN: ${w}`),
      ...result.failures.map((f) => `   REFUSE [${f.code}]: ${f.reason}`),
      `   VERDICT: ${result.ok ? 'PASS' : 'REFUSED'}`,
    ];
    deps.stdout(lines.join('\n'));
  }

  return { exitCode: result.ok ? 0 : 2, data: payload };
}

async function handleSet(positionals, flags, deps) {
  if (positionals.length < 2) {
    throw new Error('set requires <option> <targetState>');
  }
  const [option, targetState] = positionals;
  if (!flags.changedBy) {
    throw new Error('set requires --changed-by "<actor>"');
  }
  if (!flags.reason) {
    throw new Error('set requires --reason "<why>"');
  }

  const { nowUtc, resolvedEvidenceSha, result } = await runPreflightCore(
    option,
    targetState,
    flags,
    deps
  );

  if (!result.ok) {
    const payload = {
      command: 'set',
      executed: false,
      option,
      targetState,
      timestampUtc: nowUtc.toISOString(),
      ...result,
    };
    if (flags.json) {
      deps.stdout(JSON.stringify(payload, null, 2));
    } else {
      deps.stderr(
        [
          `== SET REFUSED (${option} -> ${targetState})`,
          ...result.failures.map((f) => `   REFUSE [${f.code}]: ${f.reason}`),
        ].join('\n')
      );
    }
    return { exitCode: 2, data: payload };
  }

  const note = buildSwitchNote({
    option,
    targetState,
    reason: flags.reason,
    authority: flags.authority,
    evidenceSha: resolvedEvidenceSha,
    isStyleOption: result.isStyleOption,
    isRollback: flags.rollback,
  });

  const sql = buildSwitchSetSql({
    option,
    targetState,
    changedBy: flags.changedBy,
    note,
  });

  if (flags.dryRun) {
    const payload = {
      command: 'set',
      dryRun: true,
      executed: false,
      option,
      fromState: result.currentState ?? 'default',
      targetState,
      changedBy: flags.changedBy,
      note,
      sql,
    };
    if (flags.json) {
      deps.stdout(JSON.stringify(payload, null, 2));
    } else {
      deps.stdout(
        [
          `== SET DRY-RUN (${option}: ${payload.fromState} -> ${targetState})`,
          `   note: ${note}`,
          `   sql:  ${sql}`,
          '   No write was executed (--dry-run).',
        ].join('\n')
      );
    }
    return { exitCode: 0, data: payload };
  }

  // Capture telemetry baseline before the write so verify-pickup has an exact baseline.
  const preTelemetry = deps.queryDb(buildPickupTelemetrySql(option, targetState));
  const seenFeature = `option_switch_${option}_${targetState}_seen`;
  const preBaseline = Number(preTelemetry.find((r) => r.feature === seenFeature)?.fires ?? 0);

  // Execute the switch write via supabase db query --linked (service-role SECURITY DEFINER RPC).
  deps.queryDb(sql);

  // Mandatory readback verification (RULE 8: read back every write).
  const readbackRows = deps.queryDb(buildReadbackSql(option));
  const row = readbackRows[0];
  if (!row || row.state !== targetState || row.note !== note) {
    throw new Error(
      `READBACK FAILED for ${option}: expected state=${targetState}, got ${JSON.stringify(row)}`
    );
  }

  const verifiedText = row.latest_audit_id
    ? `readback ok (audit#${row.latest_audit_id}; pickup pending)`
    : 'readback ok (pickup pending)';
  const logLine = formatSwitchChangeLogLine({
    timestampUtc: row.updated_at || nowUtc,
    option,
    fromState: result.currentState ?? 'default',
    toState: targetState,
    changedBy: flags.changedBy,
    reason: flags.rollback ? `rollback: ${flags.reason}` : flags.reason,
    verified: verifiedText,
  });

  if (flags.logFile) {
    deps.appendLogLine(flags.logFile, logLine);
  }

  const payload = {
    command: 'set',
    executed: true,
    option,
    fromState: result.currentState ?? 'default',
    targetState,
    updatedAt: row.updated_at,
    auditId: row.latest_audit_id ?? null,
    note,
    prePickupBaseline: preBaseline,
    logFile: flags.logFile || null,
    logLine,
  };

  if (flags.json) {
    deps.stdout(JSON.stringify(payload, null, 2));
  } else {
    deps.stdout(
      [
        `== SET COMPLETE (${option}: ${payload.fromState} -> ${targetState})`,
        `   updated_at: ${row.updated_at} (audit#${row.latest_audit_id ?? '?'})`,
        `   log line:   ${logLine}`,
        flags.logFile ? `   appended:   ${flags.logFile}` : '   log file:   (not provided)',
        `   next step:  node scripts/ops/horse-option-switch.mjs verify-pickup ${option} ${targetState} --baseline ${preBaseline}`,
      ].join('\n')
    );
  }

  return { exitCode: 0, data: payload };
}

async function handleVerifyPickup(positionals, flags, deps) {
  if (positionals.length < 2) {
    throw new Error('verify-pickup requires <option> <expectedState>');
  }
  const [option, expectedState] = positionals;
  const sql = buildPickupTelemetrySql(option, expectedState);
  const telemetryRows = deps.queryDb(sql);

  const verdict = evaluatePickup({
    option,
    expectedState,
    telemetryRows,
    baseline: flags.baseline,
    minWorkers: flags.minWorkers ?? DEFAULT_MIN_PICKUP_WORKERS,
  });

  const payload = {
    command: 'verify-pickup',
    option,
    expectedState,
    ...verdict,
  };

  if (flags.json) {
    deps.stdout(JSON.stringify(payload, null, 2));
  } else {
    deps.stdout(
      [
        `== VERIFY PICKUP ${option} == ${expectedState}`,
        `   feature: ${verdict.targetFeature} fires=${verdict.currentFires} baseline=${verdict.baseline} delta=${verdict.delta} (need >= ${verdict.minWorkers})`,
        `   config alarms: ${
          verdict.alarms.length > 0
            ? verdict.alarms.map((a) => `${a.feature}(+${a.delta})`).join(', ')
            : '0 (clean)'
        }`,
        ...verdict.failures.map((f) => `   FAIL [${f.code}]: ${f.reason}`),
        `   VERDICT: ${verdict.ok ? 'PASS' : 'FAIL'}`,
      ].join('\n')
    );
  }

  return { exitCode: verdict.ok ? 0 : 2, data: payload };
}

export async function runCli(argv, injectedDeps = {}) {
  const { command, positionals, flags } = parseCliArgs(argv);
  const deps = {
    queryDb: (sql) => defaultQueryDb(sql, { workdir: flags.workdir }),
    fetchHealth: defaultFetchHealth,
    readFile: defaultReadFile,
    readFileBuffer: defaultReadFileBuffer,
    appendLogLine: defaultAppendLogLine,
    now: () => new Date(),
    stdout: (msg) => console.log(msg),
    stderr: (msg) => console.error(msg),
    ...injectedDeps,
  };

  if (command === 'help') {
    deps.stdout(USAGE);
    return { exitCode: 0, data: null };
  }
  if (command === 'status') return handleStatus(flags, deps);
  if (command === 'preflight') return handlePreflight(positionals, flags, deps);
  if (command === 'set') return handleSet(positionals, flags, deps);
  if (command === 'verify-pickup') return handleVerifyPickup(positionals, flags, deps);

  throw new Error(
    `Unknown subcommand "${command}". Expected: status, preflight, set, verify-pickup`
  );
}

const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error(`ERROR: ${err?.message || String(err)}`);
      process.exit(1);
    });
}
