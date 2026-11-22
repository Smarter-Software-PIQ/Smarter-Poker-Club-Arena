/**
 * Read-only triage for EngineReleaseFailed incidents and sanctioned, bounded
 * incident-claim submission via `smarter_private.fn_claim_reliability_incident`.
 *
 * Never restarts, mutates, or retries an engine release.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { resolveEngineAlertEpisode } from './resolve-engine-alert-episode.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyEngineReleaseTriage({ targetSha, liveHealth, isAncestor }) {
  const target = String(targetSha ?? '').trim();
  if (!SHA_RE.test(target)) {
    return {
      verdict: 'unknown',
      actionableFailure: true,
      summary: 'Target SHA is not a full 40-character lowercase hex commit SHA.',
    };
  }
  if (!liveHealth || typeof liveHealth !== 'object') {
    return {
      verdict: 'unknown',
      actionableFailure: true,
      summary: 'Live engine health payload was unreadable.',
    };
  }

  const serving = typeof liveHealth.releaseSha === 'string' ? liveHealth.releaseSha.trim() : '';
  const healthy =
    liveHealth.status === 'ok' &&
    liveHealth.liveness === 'ok' &&
    liveHealth.settlementStatus === 'ok' &&
    liveHealth.wholeFleetStalled !== true;

  if (!SHA_RE.test(serving)) {
    return {
      verdict: 'unknown',
      actionableFailure: true,
      summary: 'Live engine health did not expose a valid 40-char releaseSha.',
    };
  }

  if (!healthy) {
    return {
      verdict: 'engine_unhealthy',
      actionableFailure: true,
      servingSha: serving,
      summary: `Live engine serving ${serving.slice(0, 8)} reports degraded health (status=${liveHealth.status}, liveness=${liveHealth.liveness}, settlement=${liveHealth.settlementStatus}).`,
    };
  }

  if (serving === target) {
    return {
      verdict: 'already_live_exact',
      actionableFailure: false,
      servingSha: serving,
      summary: `Production is already healthy on exact target ${target.slice(0, 8)} (likely duplicate/redelivered release attempt).`,
    };
  }

  if (typeof isAncestor === 'function' && isAncestor(target, serving) === true) {
    return {
      verdict: 'already_superseded',
      actionableFailure: false,
      servingSha: serving,
      summary: `Production is already healthy on newer SHA ${serving.slice(0, 8)} which contains target ${target.slice(0, 8)}.`,
    };
  }

  return {
    verdict: 'target_not_serving',
    actionableFailure: true,
    servingSha: serving,
    summary: `Production is still serving ${serving.slice(0, 8)}, which does not contain target ${target.slice(0, 8)}.`,
  };
}

export function validateIncidentInspectInputs({ incidentId }) {
  const id = String(incidentId ?? '').trim();
  if (!UUID_RE.test(id)) {
    throw new Error('incident_id must be a valid UUID');
  }
  return { incidentId: id };
}

export function validateIncidentClaimInputs({
  incidentId,
  agentSession,
  branch = '',
  pullRequest = '',
  ttlHours = '4',
}) {
  const id = String(incidentId ?? '').trim();
  if (!UUID_RE.test(id)) {
    throw new Error('incident_id must be a valid UUID');
  }
  const session = String(agentSession ?? '').trim();
  if (!session || session.length > 160) {
    throw new Error('agent_session must be a non-empty string (<= 160 chars)');
  }
  const cleanBranch =
    String(branch ?? '')
      .trim()
      .slice(0, 200) || null;
  const cleanPr =
    String(pullRequest ?? '')
      .trim()
      .slice(0, 200) || null;
  const parsedTtl = Number(String(ttlHours ?? '4').trim());
  if (!Number.isInteger(parsedTtl) || parsedTtl < 1 || parsedTtl > 24) {
    throw new Error('ttl_hours must be an integer between 1 and 24');
  }
  return {
    incidentId: id,
    agentSession: session,
    branch: cleanBranch,
    pullRequest: cleanPr,
    ttlHours: parsedTtl,
  };
}

function gitIsAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function runTriage() {
  const targetSha = (process.env.TARGET_SHA || '').trim();
  const healthUrl = (process.env.ENGINE_HEALTH_URL || 'https://engine.smarter.poker/health').trim();
  const res = await fetch(`${healthUrl}?cb=${Date.now()}`, {
    headers: { 'cache-control': 'no-store' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Engine health endpoint returned HTTP ${res.status}`);
  }
  const liveHealth = await res.json();
  const result = classifyEngineReleaseTriage({
    targetSha,
    liveHealth,
    isAncestor: gitIsAncestor,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runInspect() {
  const { incidentId } = validateIncidentInspectInputs({
    incidentId: process.env.INCIDENT_ID,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');

  const { Client } = await import('pg');
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
  });
  try {
    await client.connect();
    const { rows: incRows } = await client.query(
      `SELECT id, fingerprint, incident_class, title, severity, status, source, alertname,
              scope, opened_at, first_observed_at, last_observed_at, last_firing_at,
              last_resolved_at, closure_basis, resolution_state, occurrence_count,
              recurrence_count, escalation_state, escalation_reason, engine_release
         FROM smarter_private.reliability_incidents
        WHERE id = $1::uuid`,
      [incidentId]
    );
    if (incRows.length === 0) {
      console.log(JSON.stringify({ found: false, incidentId }, null, 2));
      return;
    }
    const { rows: obsRows } = await client.query(
      `SELECT id, inbox_event_id, delivery_count, status, severity, disposition, observed_at
         FROM smarter_private.reliability_observations
        WHERE incident_id = $1::uuid
        ORDER BY id DESC
        LIMIT 5`,
      [incidentId]
    );
    const { rows: evtRows } = await client.query(
      `SELECT id, kind, from_status, to_status, at, detail
         FROM smarter_private.reliability_incident_events
        WHERE incident_id = $1::uuid
        ORDER BY id DESC
        LIMIT 5`,
      [incidentId]
    );
    console.log(
      JSON.stringify(
        {
          found: true,
          incident: incRows[0],
          recentObservations: obsRows,
          recentEvents: evtRows,
        },
        null,
        2
      )
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function runClaim() {
  const validated = validateIncidentClaimInputs({
    incidentId: process.env.INCIDENT_ID,
    agentSession: process.env.AGENT_SESSION,
    branch: process.env.CLAIM_BRANCH,
    pullRequest: process.env.CLAIM_PR,
    ttlHours: process.env.CLAIM_TTL_HOURS || '4',
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');

  const { Client } = await import('pg');
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT smarter_private.fn_claim_reliability_incident(
         $1::uuid,
         $2::text,
         $3::text,
         $4::text,
         ($5::text || ' hours')::interval
       ) AS claim`,
      [
        validated.incidentId,
        validated.agentSession,
        validated.branch,
        validated.pullRequest,
        String(validated.ttlHours),
      ]
    );
    console.log(JSON.stringify(rows[0]?.claim ?? null, null, 2));
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const mode = (process.env.OPERATION || 'triage').trim();
  if (mode === 'triage') {
    await runTriage();
    return;
  }
  if (mode === 'inspect') {
    await runInspect();
    return;
  }
  if (mode === 'claim') {
    await runClaim();
    return;
  }
  if (mode === 'resolve') {
    // The one sanctioned manual resolve of an engine-alerts incident: append,
    // never UPDATE (scripts/ci/resolve-engine-alert-episode.mjs).
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 15_000,
      statement_timeout: 15_000,
    });
    try {
      await client.connect();
      const result = await resolveEngineAlertEpisode(client, {
        incidentId: process.env.INCIDENT_ID,
        note: process.env.RESOLUTION_NOTE,
        agentSession: process.env.AGENT_SESSION,
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.resolved) {
        console.error(
          `::error::engine alert episode not resolved: ${result.refusal || 'intake did not resolve every appended row'}`
        );
        process.exitCode = result.refusal ? 2 : 1;
      }
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }
  throw new Error(`Unsupported operation: ${mode}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`::error::${err?.message || err}`);
    process.exit(1);
  });
}
