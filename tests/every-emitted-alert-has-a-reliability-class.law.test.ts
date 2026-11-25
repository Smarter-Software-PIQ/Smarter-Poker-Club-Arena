/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LAW: EVERY EMITTED ALERT HAS A RELIABILITY CLASS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Production audit on 2026-11-25 found active escalated and stale incidents
 * rotting in `unclassified` (OpponentHudDrift, PushZombieSubscriptions,
 * HostDiskNearlyFull, rakeback_settler_read_horizon_held, DailyDigest.*,
 * financial_attestation:🟢 Midway burn-in gate is GREEN) plus 13 Prometheus
 * rules and 4 server/src engine alerts lacking non-unclassified rules in
 * `smarter_private.reliability_alert_classes`.
 *
 * This law replays the migration corpus's `reliability_alert_classes` rules
 * in version order using PostgreSQL `reliability_classify` semantics
 * (`ILIKE`, ordered by `priority, id`) and enforces that EVERY alert emitted
 * by:
 *   1. `infra/monitoring/*.yml` (all non-quarantined Prometheus rules),
 *   2. `fn_sp_digest_attention` (`DailyDigest.*`) & `fn_sp_critical_scan`
 *      (`CriticalPage.*`), and
 *   3. Club Arena engine (`server/src/`) & SQL watches
 * resolves to an explicit non-`unclassified` `incident_class`, while the
 * global `priority = 1000` fallback stays `unclassified` for unknown alerts.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migrationCorpus } from './helpers/migrationCorpus';

const ROOT = resolve(__dirname, '..');
const MONITORING_DIR = join(ROOT, 'infra', 'monitoring');

interface ClassRule {
  id: number;
  priority: number;
  source_pattern: string;
  alertname_pattern: string;
  severity_pattern: string;
  incident_class: string;
  default_severity: string;
  escalate_immediately: boolean;
  is_incident: boolean;
}

function ilikeMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/%/g, '.*').replace(/_/g, '.') + '$';
  return new RegExp(regexStr, 'is').test(value);
}

function stripSqlComments(sql: string): string {
  let out = '';
  let inSingle = false;
  let i = 0;
  while (i < sql.length) {
    if (!inSingle && sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (!inSingle && sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (sql[i] === "'") {
      out += "'";
      i++;
      if (inSingle && sql[i] === "'") {
        out += "'";
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/** Parse SQL single-quoted string literal, boolean, number, or null from a tuple. */
function splitSqlArgs(tupleBody: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inSingle = false;
  let depth = 0;
  for (let i = 0; i < tupleBody.length; i++) {
    const ch = tupleBody[i];
    if (inSingle) {
      cur += ch;
      if (ch === "'") {
        if (tupleBody[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) args.push(cur.trim());
  return args;
}

function unquoteSql(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseBool(token: string): boolean {
  return token.trim().toLowerCase() === 'true';
}

function parseTuplesFromValues(valuesSql: string): string[][] {
  const tuples: string[][] = [];
  let i = 0;
  let inSingle = false;
  while (i < valuesSql.length) {
    const ch = valuesSql[i];
    if (inSingle) {
      if (ch === "'") {
        if (valuesSql[i + 1] === "'") i++;
        else inSingle = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '(') {
      let depth = 1;
      const start = i + 1;
      i++;
      let innerSingle = false;
      while (i < valuesSql.length && depth > 0) {
        const c = valuesSql[i];
        if (innerSingle) {
          if (c === "'") {
            if (valuesSql[i + 1] === "'") i++;
            else innerSingle = false;
          }
        } else if (c === "'") {
          innerSingle = true;
        } else if (c === '(') {
          depth++;
        } else if (c === ')') {
          depth--;
        }
        i++;
      }
      const body = valuesSql.slice(start, i - 1);
      tuples.push(splitSqlArgs(body));
      continue;
    }
    i++;
  }
  return tuples;
}

function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = '';
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    cur += ch;
    if (inSingle) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
    } else if (ch === ';') {
      stmts.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

function replayReliabilityAlertClasses(stopBeforeVersion?: string): ClassRule[] {
  const rules: ClassRule[] = [];
  let nextId = 1;

  const upsert = (row: Omit<ClassRule, 'id'>, onConflictUpdate: boolean) => {
    const existing = rules.find(
      (r) =>
        r.source_pattern === row.source_pattern &&
        r.alertname_pattern === row.alertname_pattern &&
        r.severity_pattern === row.severity_pattern
    );
    if (existing) {
      if (onConflictUpdate) {
        existing.priority = row.priority;
        existing.incident_class = row.incident_class;
        existing.default_severity = row.default_severity;
        existing.escalate_immediately = row.escalate_immediately;
        existing.is_incident = row.is_incident;
      }
      return;
    }
    rules.push({ id: nextId++, ...row });
  };

  for (const mig of migrationCorpus()) {
    const ver = mig.name.slice(0, 14);
    if (stopBeforeVersion && ver >= stopBeforeVersion) break;
    if (!mig.sql.includes('reliability_alert_classes')) continue;

    const clean = stripSqlComments(mig.sql);
    for (const stmt of splitStatements(clean)) {
      if (!stmt.includes('reliability_alert_classes')) continue;

      // 1. INSERT INTO smarter_private.reliability_alert_classes (...) VALUES (...) [ON CONFLICT ...]
      const insValues = stmt.match(
        /INSERT\s+INTO\s+smarter_private\.reliability_alert_classes(?:\s+AS\s+\w+)?\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+?)(?:ON\s+CONFLICT\b([\s\S]*))?;?$/i
      );
      if (insValues) {
        const cols = insValues[1].split(',').map((c) => c.trim().toLowerCase());
        const hasUpdate = /\bDO\s+UPDATE\b/i.test(insValues[3] ?? '');
        for (const args of parseTuplesFromValues(insValues[2])) {
          const get = (name: string, fallback: string) => {
            const idx = cols.indexOf(name);
            return idx >= 0 && args[idx] !== undefined ? args[idx] : fallback;
          };
          upsert(
            {
              priority: Number(get('priority', '1000')),
              source_pattern: unquoteSql(get('source_pattern', "'%'")),
              alertname_pattern: unquoteSql(get('alertname_pattern', "'%'")),
              severity_pattern: unquoteSql(get('severity_pattern', "'%'")),
              incident_class: unquoteSql(get('incident_class', "'unclassified'")),
              default_severity: unquoteSql(get('default_severity', "'warning'")),
              escalate_immediately: parseBool(get('escalate_immediately', 'false')),
              is_incident: parseBool(get('is_incident', 'true')),
            },
            hasUpdate
          );
        }
        continue;
      }

      // 2. INSERT INTO smarter_private.reliability_alert_classes (...) SELECT ... WHERE NOT EXISTS (...)
      const insSelect = stmt.match(
        /INSERT\s+INTO\s+smarter_private\.reliability_alert_classes(?:\s+AS\s+\w+)?\s*\(([^)]+)\)\s*SELECT\s+([\s\S]+?)\s+WHERE\s+NOT\s+EXISTS\b/i
      );
      if (insSelect) {
        const cols = insSelect[1].split(',').map((c) => c.trim().toLowerCase());
        const args = splitSqlArgs(insSelect[2]);
        const get = (name: string, fallback: string) => {
          const idx = cols.indexOf(name);
          return idx >= 0 && args[idx] !== undefined ? args[idx] : fallback;
        };
        upsert(
          {
            priority: Number(get('priority', '1000')),
            source_pattern: unquoteSql(get('source_pattern', "'%'")),
            alertname_pattern: unquoteSql(get('alertname_pattern', "'%'")),
            severity_pattern: unquoteSql(get('severity_pattern', "'%'")),
            incident_class: unquoteSql(get('incident_class', "'unclassified'")),
            default_severity: unquoteSql(get('default_severity', "'warning'")),
            escalate_immediately: parseBool(get('escalate_immediately', 'false')),
            is_incident: parseBool(get('is_incident', 'true')),
          },
          false
        );
        continue;
      }

      // 3. UPDATE smarter_private.reliability_alert_classes SET ... WHERE ...
      const upd = stmt.match(
        /UPDATE\s+smarter_private\.reliability_alert_classes\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?);?$/i
      );
      if (upd) {
        const setClause = upd[1];
        const whereClause = upd[2];
        const whereEq = (col: string): string | undefined => {
          const m = whereClause.match(new RegExp(`\\b${col}\\s*=\\s*'((?:''|[^'])*)'`, 'i'));
          return m ? m[1].replace(/''/g, "'") : undefined;
        };
        const wSrc = whereEq('source_pattern');
        const wAlert = whereEq('alertname_pattern');
        const wSev = whereEq('severity_pattern');
        const setEq = (col: string): string | undefined => {
          const m = setClause.match(new RegExp(`\\b${col}\\s*=\\s*'((?:''|[^'])*)'`, 'i'));
          return m ? m[1].replace(/''/g, "'") : undefined;
        };
        const setBool = (col: string): boolean | undefined => {
          const m = setClause.match(new RegExp(`\\b${col}\\s*=\\s*(true|false)\\b`, 'i'));
          return m ? m[1].toLowerCase() === 'true' : undefined;
        };
        const setNum = (col: string): number | undefined => {
          const m = setClause.match(new RegExp(`\\b${col}\\s*=\\s*(\\d+)\\b`, 'i'));
          return m ? Number(m[1]) : undefined;
        };

        for (const r of rules) {
          if (wSrc !== undefined && r.source_pattern !== wSrc) continue;
          if (wAlert !== undefined && r.alertname_pattern !== wAlert) continue;
          if (wSev !== undefined && r.severity_pattern !== wSev) continue;
          const nSrc = setEq('source_pattern');
          const nAlert = setEq('alertname_pattern');
          const nClass = setEq('incident_class');
          const nDefSev = setEq('default_severity');
          const nEsc = setBool('escalate_immediately');
          const nInc = setBool('is_incident');
          const nPrio = setNum('priority');
          if (nSrc !== undefined) r.source_pattern = nSrc;
          if (nAlert !== undefined) r.alertname_pattern = nAlert;
          if (nClass !== undefined) r.incident_class = nClass;
          if (nDefSev !== undefined) r.default_severity = nDefSev;
          if (nEsc !== undefined) r.escalate_immediately = nEsc;
          if (nInc !== undefined) r.is_incident = nInc;
          if (nPrio !== undefined) r.priority = nPrio;
        }
      }
    }
  }

  return rules;
}

function classify(
  rules: ClassRule[],
  source: string,
  alertname: string,
  severity = 'warning',
  resolved = false
): ClassRule | undefined {
  const matches = rules.filter(
    (c) =>
      ilikeMatch(source, c.source_pattern) &&
      ilikeMatch(alertname, c.alertname_pattern) &&
      (resolved ? c.is_incident : ilikeMatch(severity.toLowerCase(), c.severity_pattern))
  );
  matches.sort((a, b) => a.priority - b.priority || a.id - b.id);
  return matches[0];
}

function prometheusAlertsInRepo(): Array<{ file: string; alertname: string }> {
  const out: Array<{ file: string; alertname: string }> = [];
  for (const file of readdirSync(MONITORING_DIR).sort()) {
    if (!file.endsWith('.yml') || file.includes('QUARANTINED')) continue;
    const text = readFileSync(join(MONITORING_DIR, file), 'utf8');
    for (const m of text.matchAll(/^\s*-\s+alert:\s+(\S+)/gm)) {
      out.push({ file, alertname: m[1] });
    }
  }
  return out;
}

function digestAndCriticalScanAlertsInRepo(): Array<{ source: string; alertname: string }> {
  const corpus = migrationCorpus();
  const latestDef = (fnName: string): string => {
    const match = corpus
      .filter((m) =>
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\b`, 'i').test(m.sql)
      )
      .at(-1);
    if (!match) throw new Error(`Missing definition for public.${fnName} in migration corpus`);
    return match.sql;
  };

  const digestSql = latestDef('fn_sp_digest_attention');
  const digestRules = new Set<string>(['not_delivered']);
  for (const m of digestSql.matchAll(/'rule'\s*,\s*'([a-z0-9_]+)'/g)) {
    digestRules.add(m[1]);
  }

  const criticalSql = latestDef('fn_sp_critical_scan');
  const criticalFnBody =
    criticalSql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sp_critical_scan[\s\S]*?AS\s+\$([^$]*)\$[\s\S]*?\$\1\$/i
    )?.[0] ?? criticalSql;
  const criticalRules = new Set<string>(['midway_free_buy_missing', 'stuck_tournament']);
  for (const m of criticalFnBody.matchAll(/'rule'\s*,\s*'([a-z0-9_]+)'/g)) {
    criticalRules.add(m[1]);
  }
  for (const m of criticalFnBody.matchAll(/VALUES\s*\(\s*'([a-z0-9_]+)'\s*,/gi)) {
    criticalRules.add(m[1]);
  }

  return [
    ...[...digestRules]
      .sort()
      .map((r) => ({ source: 'sp-daily-digest', alertname: `DailyDigest.${r}` })),
    ...[...criticalRules]
      .sort()
      .map((r) => ({ source: 'sp-critical-pager', alertname: `CriticalPage.${r}` })),
  ];
}

function serverEngineAlertsInRepo(): string[] {
  const names = new Set<string>();
  const files = execFileSync(
    'git',
    ['grep', '-l', '-E', 'setAlert\\(|alertname\\s*[:=]', '--', 'server/src'],
    { cwd: ROOT, encoding: 'utf8' }
  )
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/setAlert\(\s*['"]([A-Za-z0-9_.:-]+)['"]/g)) {
      names.add(m[1]);
    }
    for (const m of text.matchAll(/alertname\s*[:=]\s*['"]([A-Za-z0-9_.:-]+)['"]/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

const CLUB_ARENA_WATCH_ALERTS: Array<{ source: string; alertname: string; severity?: string }> = [
  { source: 'rakeback-settler-read-horizon', alertname: 'rakeback_settler_read_horizon_held' },
  { source: 'host-heartbeat', alertname: 'HostDiskNearlyFull' },
  { source: 'host-heartbeat', alertname: 'HostHeartbeatMissing', severity: 'critical' },
  {
    source: 'cash-pot-conservation-measurement',
    alertname: 'CashPotConservation:pot_drift',
    severity: 'critical',
  },
  {
    source: 'cash-pot-conservation-measurement',
    alertname: 'CashPotConservationCheckFailed',
    severity: 'critical',
  },
  { source: 'bug-report-routing', alertname: 'Bug Report Not Delivered To Owner Messenger' },
  { source: 'cutover-readiness-watch', alertname: 'CutoverReadinessAtRisk', severity: 'critical' },
  { source: 'horse-exposure-watch', alertname: 'PersonBeatsHorsesBeyondTwoSE' },
  { source: 'financial-alerts-backfill', alertname: 'fn_horse_daily_audit_watchdog' },
  { source: 'financial-alerts-backfill', alertname: 'fn_gto_v31_round_stall_check' },
  { source: 'financial-alerts-backfill', alertname: 'fn_ca_daily_bonus_claim.budget_anomaly' },
  { source: 'worldhub.push-health', alertname: 'PushZombieSubscriptions' },
  { source: 'worldhub.push-health', alertname: 'OwnerAccountDeviceNotConfirmingPush' },
  {
    source: 'owner-operational-notifications',
    alertname: 'financial_attestation:🟢 Midway burn-in gate is GREEN',
  },
  {
    source: 'owner-operational-notifications',
    alertname: 'financial_attestation:📋 Chip integrity: attention needed',
  },
  { source: 'alertmanager', alertname: 'EventDbBulkheadSaturated' },
  { source: 'alertmanager', alertname: 'EventDbBulkheadOpen' },
];

describe('every emitted alert has an explicit non-unclassified reliability class', () => {
  const rules = replayReliabilityAlertClasses();
  const preHardeningRules = replayReliabilityAlertClasses('20261125022248');

  it('proves RED-before: prior to 20261125022248 the audited alerts fell into unclassified', () => {
    const previouslyUnclassified: Array<[string, string]> = [
      ['alertmanager', 'ClassicCashFloorDark'],
      ['alertmanager', 'HandMemoryDomainMissingOnCashShowdown'],
      ['alertmanager', 'EventDbBulkheadSaturated'],
      ['alertmanager', 'EventDbBulkheadOpen'],
      ['host-heartbeat', 'HostDiskNearlyFull'],
      ['engine-alerts-backfill', 'OpponentHudDrift'],
      ['engine-alerts-backfill', 'ClubArenaHorseFleetLoopStopped'],
      ['worldhub.push-health', 'PushZombieSubscriptions'],
      ['sp-daily-digest', 'DailyDigest.phone_verification_low'],
      ['sp-daily-digest', 'DailyDigest.client_crash'],
      ['owner-operational-notifications', 'financial_attestation:🟢 Midway burn-in gate is GREEN'],
    ];
    for (const [source, alertname] of previouslyUnclassified) {
      const cls = classify(preHardeningRules, source, alertname);
      expect(cls?.incident_class, `${source}/${alertname} before 20261125022248`).toBe(
        'unclassified'
      );
    }
  });

  it('classifies 100% of non-quarantined Prometheus alerts in infra/monitoring/*.yml out of unclassified', () => {
    const prom = prometheusAlertsInRepo();
    expect(prom.length).toBeGreaterThan(150);
    const unclassified = prom.filter(({ alertname }) => {
      const cls = classify(rules, 'alertmanager', alertname, 'warning', false);
      return !cls || cls.incident_class === 'unclassified';
    });
    expect(
      unclassified.map((u) => `${u.file}: ${u.alertname}`),
      'Add an explicit reliability_alert_classes migration mapping for every new Prometheus alert so it never rots in unclassified.'
    ).toEqual([]);
  });

  it('classifies 100% of DailyDigest.* and CriticalPage.* rules out of unclassified', () => {
    const items = digestAndCriticalScanAlertsInRepo();
    expect(items.length).toBeGreaterThanOrEqual(25);
    const unclassified = items.filter(({ source, alertname }) => {
      const cls = classify(rules, source, alertname, 'warning', false);
      return !cls || cls.incident_class === 'unclassified';
    });
    expect(
      unclassified.map((u) => `${u.source}/${u.alertname}`),
      'Add an explicit priority-150 reliability_alert_classes mapping for every DailyDigest.* / CriticalPage.* rule.'
    ).toEqual([]);
  });

  it('classifies 100% of server/src engine alerts and Club Arena SQL watches out of unclassified', () => {
    const serverAlerts = serverEngineAlertsInRepo();
    expect(serverAlerts).toContain('OpponentHudDrift');
    const allWatchPairs = [
      ...serverAlerts.map((alertname) => ({
        source: 'engine-alerts-backfill',
        alertname,
        severity: 'warning',
      })),
      ...CLUB_ARENA_WATCH_ALERTS,
    ];
    const unclassified = allWatchPairs.filter(({ source, alertname, severity }) => {
      const cls = classify(rules, source, alertname, severity ?? 'warning', false);
      return !cls || cls.incident_class === 'unclassified';
    });
    expect(
      unclassified.map((u) => `${u.source}/${u.alertname}`),
      'Add an explicit reliability_alert_classes mapping for every engine/SQL watch alert.'
    ).toEqual([]);
  });

  it('preserves the global priority-1000 unclassified fallback and non-incident receipts', () => {
    const unknown = classify(rules, 'alertmanager', 'SomethingNobodyClassified', 'warning', false);
    expect(unknown?.incident_class).toBe('unclassified');
    expect(unknown?.escalate_immediately).toBe(true);

    const warming = classify(
      rules,
      'alertmanager',
      'HorseFleetThroughputBaselineWarming',
      'warning',
      false
    );
    expect(warming?.incident_class).toBe('horse_fleet_throughput');
    expect(warming?.is_incident).toBe(false);

    const exposure = classify(
      rules,
      'horse-exposure-watch',
      'PersonBeatsHorsesBeyondTwoSE',
      'warning',
      false
    );
    expect(exposure?.incident_class).toBe('horse_exposure_analysis');
    expect(exposure?.is_incident).toBe(false);

    const greenGate = classify(
      rules,
      'owner-operational-notifications',
      'financial_attestation:🟢 Midway burn-in gate is GREEN',
      'warning',
      false
    );
    expect(greenGate?.incident_class).toBe('development_notification');
    expect(greenGate?.is_incident).toBe(false);

    const chipAttention = classify(
      rules,
      'owner-operational-notifications',
      'financial_attestation:📋 Chip integrity: attention needed',
      'warning',
      false
    );
    expect(chipAttention?.incident_class).toBe('money_integrity');
    expect(chipAttention?.is_incident).toBe(true);
  });

  it('hardening migration stays pure DML (zero function or cron.job collisions) with a live proof', () => {
    const mig = migrationCorpus().find((m) =>
      m.name.endsWith('_classify_remaining_alerts_and_backfill_unclassified_incident.sql')
    );
    expect(mig, 'Track 3 alert-classification migration must exist').toBeDefined();
    expect(mig!.sql).toContain('-- @live-proof:');
    expect(mig!.sql).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
    expect(mig!.sql).not.toMatch(/\bcron\.(?:schedule|alter_job|unschedule)\b/i);
  });
});
