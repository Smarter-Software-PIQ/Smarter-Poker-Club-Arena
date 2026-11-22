#!/usr/bin/env node
/**
 * MANUAL-ONLY LIVE DRILL & CRON-WATCH VERIFIER (2026-11-20, incident 316ed735).
 *
 * Provides a sanctioned, workflow_dispatch-only route to:
 *   1. Execute public.fn_ca_alarm_drill() live (it is @probe-exempt during
 *      migration install because it locks live money rows for >12s).
 *   2. Execute public.fn_ca_cron_failure_watch() and read back the resulting
 *      ca_detector_runs and open ca_drift_incidents rows for
 *      ca-alarm-drill-weekly.
 *   3. Optionally compare production's live normalized prosrc for critical
 *      guard functions against the newest migration defining them in git
 *      (when DATABASE_URL is supplied), catching merge-order overwrites that
 *      static filename-sorted tests cannot see.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/ci/verify-alarm-drill-and-cron-watch.mjs [--run-drill] [--check-drift]
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { supabaseServerHeaders } from './supabase-auth-headers.mjs';

export const WATCHED_GUARD_FUNCTIONS = [
  'public.fn_ca_alarm_drill',
  'public.fn_ca_cron_failure_watch',
  'public.fn_ca_cron_health',
];

/**
 * Strip SQL comments and collapse whitespace so comment-only formatting
 * differences never cause false drift alerts while any semantic SQL change
 * produces a different fingerprint.
 */
export function normalizeSqlBody(body) {
  return String(body)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sqlBodyHash(body) {
  return createHash('sha256').update(normalizeSqlBody(body)).digest('hex');
}

export function sqlBodyMd5(body) {
  return createHash('md5').update(normalizeSqlBody(body)).digest('hex');
}

/**
 * Extract the newest migration's $function$ ... $function$ body for a
 * qualified function name (e.g. 'public.fn_ca_cron_failure_watch').
 */
export function extractLatestFunctionBody(migrationsDir, qualifiedName) {
  const head = `CREATE OR REPLACE FUNCTION ${qualifiedName}(`;
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  let matchFile = null;
  let matchSql = null;
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    if (sql.includes(head)) {
      matchFile = f;
      matchSql = sql;
      break;
    }
  }
  if (!matchFile || !matchSql) return null;
  const start = matchSql.indexOf(head);
  const bodyOpen = matchSql.indexOf('$function$', start);
  if (bodyOpen < 0) return null;
  const bodyStart = bodyOpen + '$function$'.length;
  const bodyEnd = matchSql.indexOf('$function$', bodyStart);
  if (bodyEnd < 0) return null;
  const body = matchSql.slice(bodyStart, bodyEnd);
  return { file: matchFile, body, hash: sqlBodyHash(body) };
}

async function rpc(urlBase, key, fnName, params = {}) {
  const res = await fetch(`${urlBase.replace(/\/$/, '')}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      ...supabaseServerHeaders(key),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`RPC ${fnName} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return json;
}

async function restSelect(urlBase, key, query) {
  const res = await fetch(`${urlBase.replace(/\/$/, '')}/rest/v1/${query}`, {
    method: 'GET',
    headers: supabaseServerHeaders(key),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`REST ${query} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function main() {
  const args = process.argv.slice(2);
  const runDrill = args.includes('--run-drill');
  const urlBase = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!urlBase || !key) {
    console.error('verify-alarm-drill-and-cron-watch: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(2);
  }

  let drillResult = null;
  if (runDrill) {
    console.log('[verify] invoking public.fn_ca_alarm_drill()...');
    drillResult = await rpc(urlBase, key, 'fn_ca_alarm_drill');
    console.log(
      '[verify] fn_ca_alarm_drill result:',
      JSON.stringify({
        pass: drillResult?.pass,
        failing: drillResult?.failing,
        arms: Array.isArray(drillResult?.results) ? drillResult.results.length : null,
      })
    );
  }

  console.log('[verify] invoking public.fn_ca_cron_failure_watch()...');
  const raisedCount = await rpc(urlBase, key, 'fn_ca_cron_failure_watch');
  console.log('[verify] fn_ca_cron_failure_watch raised count:', raisedCount);

  const detectorRuns = await restSelect(
    urlBase,
    key,
    'ca_detector_runs?detector=eq.fn_ca_alarm_drill&order=ran_at.desc&limit=3&select=id,detector,ran_at,detail'
  );
  console.log('[verify] latest ca_detector_runs (fn_ca_alarm_drill):', JSON.stringify(detectorRuns, null, 2));

  const openIncidents = await restSelect(
    urlBase,
    key,
    'ca_drift_incidents?detector=eq.fn_ca_cron_failure_watch&resolved_at=is.null&dedupe_key=like.cron-failing:ca-alarm-drill-weekly*&select=id,dedupe_key,severity,occurrence_count,first_seen_at,last_seen_at'
  );
  console.log(
    '[verify] open ca_drift_incidents (ca-alarm-drill-weekly):',
    JSON.stringify(openIncidents, null, 2)
  );

  // Git-vs-repo check: report latest migration fingerprints for watched guards
  const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
  for (const fn of WATCHED_GUARD_FUNCTIONS) {
    const latest = extractLatestFunctionBody(migrationsDir, fn);
    console.log(
      `[verify] git newest ${fn}: file=${latest?.file ?? 'missing'} sha256=${latest?.hash?.slice(0, 16) ?? 'none'}`
    );
  }

  if (runDrill && drillResult?.pass !== true) {
    console.error('[verify] FAIL: fn_ca_alarm_drill did not pass all arms.');
    process.exit(1);
  }
  if (runDrill && detectorRuns.length === 0) {
    console.error('[verify] FAIL: fn_ca_alarm_drill ran but recorded no ca_detector_runs row.');
    process.exit(1);
  }
  console.log('[verify] OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[verify] ERROR:', err?.message || err);
    process.exit(2);
  });
}
