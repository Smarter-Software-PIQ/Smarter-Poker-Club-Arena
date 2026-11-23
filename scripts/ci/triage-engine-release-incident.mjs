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
    statement_timeout: 8_000,
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
    const safeSelect = async (sql, params = []) => {
      try {
        const res = await client.query(sql, params);
        return res.rows;
      } catch (err) {
        return { queryError: String(err?.message || err).slice(0, 240) };
      }
    };
    const inboxIds = obsRows
      .map((r) => Number(r.inbox_event_id))
      .filter((n) => Number.isSafeInteger(n) && n > 0);
    const inboxEvents =
      inboxIds.length > 0
        ? await safeSelect(
            `SELECT to_jsonb(e) AS row
               FROM public.operational_alert_events e
              WHERE e.id = ANY($1::bigint[])
              ORDER BY e.id DESC
              LIMIT 5`,
            [inboxIds]
          )
        : [];
    const inc = incRows[0];
    const context = {};
    if (
      inc.alertname === 'CutoverReadinessAtRisk' ||
      inc.alertname === 'EngineCutoverMissed' ||
      inc.source === 'cutover-readiness-watch'
    ) {
      context.cutoverReadinessRuns = await safeSelect(
        `SELECT id, cutover_day, checked_at, verdict, reasons, unknowns, facts, alert_id
           FROM smarter_private.ca_cutover_readiness_runs
          ORDER BY checked_at DESC
          LIMIT 5`
      );
      context.cutoverDays = await safeSelect(
        `SELECT chicago_day, checked_at, serving_sha, owed_sha, verdict, reason, alert_id
           FROM smarter_private.ca_engine_cutover_days
          ORDER BY chicago_day DESC
          LIMIT 5`
      );
      context.migrationWatch = await safeSelect(
        `SELECT to_jsonb(w) AS row
           FROM smarter_private.ca_merged_migration_watch w
          WHERE w.installed_seen_at IS NULL
             OR w.retired_at IS NOT NULL
             OR w.version IN ('20261123002808', '20261123024924', '20261123013136', '20261123071654')
          ORDER BY w.merged_at DESC
          LIMIT 20`
      );
      context.guardDefSnapshot = await safeSelect(
        `SELECT to_jsonb(g) AS guard_row,
                md5(pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure)) AS live_def_md5,
                has_function_privilege('anon', 'public.fn_ca_closed_arena_finding_is_intended()', 'EXECUTE') AS closed_arena_anon_exec
           FROM public.ca_guard_defs g
          WHERE g.proname = 'fn_poker_diamond_tournament_unregister'`
      );
    }
    if (
      inc.alertname === 'WeeklyPayoutNotReadyHalfHourBefore' ||
      inc.alertname === 'union_accounting_scheduler' ||
      inc.source === 'weekly-payout' ||
      inc.source === 'financial-alerts-backfill'
    ) {
      context.financialAlerts = await safeSelect(
        `SELECT to_jsonb(a) AS row
           FROM public.financial_alerts a
          WHERE a.resolved IS NOT TRUE
            AND a.source IN ('union_accounting_scheduler', 'weekly_club_accounting', 'weekly-payout')
          ORDER BY a.created_at DESC
          LIMIT 10`
      );
      context.weeklyPayoutPauses = await safeSelect(
        `SELECT run_id, period_start, period_end, phase, announced_at, money_starts_at,
                money_deadline_at, expires_at, result
           FROM public.weekly_accounting_payout_pauses
          ORDER BY period_end DESC, announced_at DESC
          LIMIT 5`
      );
      context.weeklyPayoutAdmittedProofs = await safeSelect(
        `SELECT run_id, scope_kind, scope_id, period_start, period_end,
                held_at, held_round, held_reason
           FROM smarter_private.weekly_payout_admitted_proofs
          ORDER BY period_end DESC, held_at DESC NULLS LAST
          LIMIT 15`
      );
      context.weeklyPrepShardRuns = await safeSelect(
        `SELECT id, shard, period_end, started_at, finished_at, units, last_unit, last_error
           FROM smarter_private.weekly_prep_shard_runs
          WHERE last_error IS NOT NULL
          ORDER BY started_at DESC
          LIMIT 10`
      );
      context.recomputeRequests = await safeSelect(
        `SELECT to_jsonb(q) AS row
           FROM public.accounting_period_recompute_requests q
          ORDER BY q.period_end DESC, q.last_requested_at DESC
          LIMIT 10`
      );
      const periodEnd = inc.scope?.period_end || '2026-11-23T08:00:00+00:00';
      const periodStart = '2026-11-16T08:00:00+00:00';
      const midwayUnion = 'fade0000-0000-0000-0000-000000000001';
      context.promoGrossCashRakeProof = await safeSelect(
        `WITH acc AS (
           SELECT COALESCE(sum((x->>'rake')::numeric) FILTER (WHERE (x->>'kind')::int = 0), 0) AS accepted_rake,
                  COALESCE(sum((x->>'hands')::bigint) FILTER (WHERE (x->>'kind')::int = 0), 0) AS hands
             FROM public.accounting_close_partials p
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.value->'groups', '[]'::jsonb)) x
            WHERE p.kind = 'pnl_hands_window'
              AND p.union_id = $1::uuid
              AND p.period_start = $2::timestamptz
              AND p.period_end = $3::timestamptz
         ),
         earned AS (
           SELECT COALESCE(sum(s.rake_credit) FILTER (WHERE s.source_type = 'cash_rake_accrual'), 0) AS payable_cash_rake,
                  COALESCE(sum(COALESCE((s.contract->>'rake_credit')::numeric, s.rake_credit)) FILTER (WHERE s.source_type = 'cash_rake_accrual'), 0) AS gross_cash_rake,
                  COALESCE(sum(COALESCE((s.contract->>'promo_excluded_credit')::numeric, 0)) FILTER (WHERE s.source_type = 'cash_rake_accrual'), 0) AS cash_promo_excluded,
                  count(*) FILTER (WHERE s.source_type = 'cash_rake_accrual' AND COALESCE((s.contract->>'promo_excluded_credit')::numeric, 0) > 0) AS cash_promo_rows,
                  COALESCE(sum(s.rake_credit) FILTER (WHERE s.source_type = 'tournament_fee_accrual'), 0) AS payable_tourn_rake,
                  COALESCE(sum(COALESCE((s.contract->>'rake_credit')::numeric, s.rake_credit)) FILTER (WHERE s.source_type = 'tournament_fee_accrual'), 0) AS gross_tourn_rake,
                  COALESCE(sum(COALESCE((s.contract->>'promo_excluded_credit')::numeric, 0)) FILTER (WHERE s.source_type = 'tournament_fee_accrual'), 0) AS tourn_promo_excluded
             FROM public.accounting_payable_earning_sources s
            WHERE s.union_id = $1::uuid
              AND s.earned_at >= $2::timestamptz
              AND s.earned_at < $3::timestamptz
         ),
         str AS (
           SELECT public.fn_union_pnl_week_rake_straddle($1::uuid, $2::timestamptz, $3::timestamptz) AS straddle
         )
         SELECT a.hands, a.accepted_rake, s.straddle,
                e.payable_cash_rake, e.gross_cash_rake, e.cash_promo_excluded, e.cash_promo_rows,
                (a.accepted_rake - s.straddle - e.payable_cash_rake) AS payable_net_diff,
                (a.accepted_rake - s.straddle - e.gross_cash_rake) AS gross_net_diff,
                e.payable_tourn_rake, e.gross_tourn_rake, e.tourn_promo_excluded
           FROM acc a CROSS JOIN earned e CROSS JOIN str s`,
        [midwayUnion, periodStart, periodEnd]
      );
      context.livePinsAndAnchors = await safeSelect(
        `WITH fns AS (
           SELECT md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure)) AS report_md5,
                  md5(pg_get_functiondef('public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz)'::regprocedure)) AS straddle_md5,
                  md5(pg_get_functiondef('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure)) AS advance_md5,
                  md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure)) AS psm_md5,
                  smarter_private.original_inventory_proof_sources_match() AS psm_ok,
                  smarter_private.original_inventory_basis_generation() AS basis_gen,
                  substring(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure) FROM '(?s)rake AS MATERIALIZED \\(.{1,750}') AS report_rake_cte,
                  pg_get_functiondef('public.fn_union_pnl_week_rake_straddle(uuid,timestamptz,timestamptz)'::regprocedure) AS straddle_def
         )
         SELECT f.*,
                (SELECT COALESCE(jsonb_agg(jsonb_build_object('fn', q.oid::regprocedure::text, 'pins', m.label)), '[]'::jsonb)
                   FROM (VALUES ('report', f.report_md5), ('straddle', f.straddle_md5), ('advance', f.advance_md5), ('psm', f.psm_md5)) m(label, h)
                   JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, m.h) > 0) AS all_pinners
           FROM fns f`
      );
    }
    const openDriftIncidents = await safeSelect(
      `SELECT to_jsonb(d) AS row
         FROM public.ca_drift_incidents d
        WHERE d.resolved_at IS NULL
        ORDER BY d.detected_at DESC
        LIMIT 20`
    );
    const latestDigestAttention = await safeSelect(
      `SELECT day, computed_at, attention
         FROM public.sp_daily_metrics
        ORDER BY day DESC
        LIMIT 2`
    );
    const digestAlertDetails = await safeSelect(
      `SELECT to_jsonb(e) AS row
         FROM public.operational_alert_events e
        WHERE e.id IN (447812, 447813)
        ORDER BY e.id DESC`
    );
    const unpickedCriticalAlerts24h = await safeSelect(
      `SELECT e.id, e.source, e.alertname, e.severity, e.status, e.received_at,
              e.investigation_status, e.investigation
         FROM public.operational_alert_events e
        WHERE (e.received_at >= now() - interval '24 hours'
               AND e.severity = 'critical'
               AND (e.investigation_status IS NULL
                    OR e.investigation_status NOT IN ('verified_fixed', 'informational')))
           OR e.id IN (447812, 447813, 447851, 447865, 447897)
        ORDER BY e.id DESC
        LIMIT 25`
    );
    console.log(
      JSON.stringify(
        {
          found: true,
          incident: inc,
          recentObservations: obsRows,
          recentEvents: evtRows,
          inboxEvents,
          context,
          openDriftIncidents,
          latestDigestAttention,
          digestAlertDetails,
          unpickedCriticalAlerts24h,
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
    statement_timeout: 8_000,
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
