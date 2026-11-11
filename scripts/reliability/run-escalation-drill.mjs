#!/usr/bin/env node
/**
 * RELIABILITY CONTROLLER ESCALATION DRILL (run by hand, never scheduled).
 *
 * One invocation proves, against production, that a critical fault reaching
 * the operational inbox ends as exactly one Messenger DM and one phone push to
 * the owner, and that the incident then resolves through the normal path:
 *
 *   1. start   public.fn_reliability_drill('start', id) records one synthetic
 *              critical event through public.fn_record_operational_alert,
 *              the intake every producer uses. The controller opens a
 *              reliability_drill incident and queues one escalation.
 *   2. wait    the per-minute reliability-controller-tick delivers it
 *              (fn_send_message_once plus one push_outbox row) and mirrors
 *              the push dispatcher's answer into push_state.
 *   3. resolve always, even after a failure, so a drill never stays escalated
 *              and never earns a reminder: a producer-style resolved row.
 *   4. verify  reads back the incident, the notification (state, message_id,
 *              push_state), the Messenger message and the push row.
 *
 * Prints PASS or FAIL with every identifier. Exit codes: 0 PASS, 1 FAIL,
 * 3 UNKNOWN (the database could not be asked; that is not a pass).
 * Migration 20261111133716 defines the function; workflow
 * .github/workflows/reliability-escalation-drill.yml runs this file with the
 * repository's existing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets.
 * The drill refuses a second run inside 10 minutes.
 *
 * Usage: node scripts/reliability/run-escalation-drill.mjs <drill-id>
 */
import { appendFileSync } from 'node:fs';

const DELIVERY_BUDGET_MS = 6 * 60_000;
const RESOLVE_BUDGET_MS = 60_000;
const POLL_MS = 10_000;

class Unknown extends Error {}

const drillId = (process.argv[2] || process.env.DRILL_ID || '').trim();
const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function finish(code, verdict, lines) {
  const text = [`${verdict}: reliability escalation drill ${drillId || '(none)'}`, ...lines].join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n');
  }
  process.exit(code);
}

async function rpc(action) {
  let res;
  try {
    res = await fetch(`${url}/rest/v1/rpc/fn_reliability_drill`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: action, p_drill_id: drillId }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Unknown(`${action}: the database could not be reached (${error?.name ?? 'error'})`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body && typeof body.message === 'string' ? body.message : text.slice(0, 300);
    if (res.status >= 500 && !/RELIABILITY_DRILL_/.test(message)) throw new Unknown(`${action}: HTTP ${res.status} ${message}`);
    throw new Error(`${action}: HTTP ${res.status} ${message}`);
  }
  if (!body || typeof body !== 'object') throw new Unknown(`${action}: unreadable answer`);
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describe(v) {
  const n = v?.notification ?? {};
  const i = v?.incident ?? {};
  const m = v?.message ?? {};
  return [
    `drill_id=${v?.drill_id ?? drillId}`,
    `firing_inbox_event_id=${v?.firing_inbox_event_id ?? 'none'} resolved_inbox_event_id=${v?.resolved_inbox_event_id ?? 'none'}`,
    `incident_id=${i.id ?? 'none'} status=${i.status ?? 'none'} class=${i.incident_class ?? 'none'} severity=${i.severity ?? 'none'}`,
    `notification_id=${n.id ?? 'none'} state=${n.state ?? 'none'} message_id=${n.message_id ?? 'none'} sent_at=${n.sent_at ?? 'none'}`,
    `push_outbox_id=${n.push_outbox_id ?? 'none'} push_state=${n.push_state ?? 'none'} push_detail=${n.push_detail ?? 'none'}`,
    `messenger_message_id=${m.id ?? 'none'} conversation_id=${m.conversation_id ?? 'none'} to_owner_conversation=${m.to_owner_conversation ?? false} says_drill=${m.says_drill ?? false}`,
    `escalation_notifications=${v?.escalation_notifications ?? 0} messages_for_request=${v?.messages_for_request ?? 0} push_rows=${v?.push_rows ?? 0}`,
    `resolved_disposition=${v?.resolved_disposition ?? 'none'} delivered=${v?.delivered ?? false} resolved=${v?.resolved ?? false} notify_mode=${v?.notify_mode ?? 'unknown'}`,
    'provider_accepted means the push provider accepted the push; it is not proof the phone displayed it.',
  ];
}

async function main() {
  if (!/^[a-z0-9][a-z0-9-]{5,47}$/.test(drillId)) finish(1, 'FAIL', ['drill id must be 6 to 48 lowercase letters, digits or hyphens']);
  if (!url || !key) finish(3, 'UNKNOWN', ['SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required']);

  let started;
  try {
    started = await rpc('start');
  } catch (error) {
    finish(error instanceof Unknown ? 3 : 1, error instanceof Unknown ? 'UNKNOWN' : 'FAIL', [error.message]);
  }
  console.log(`started: ${JSON.stringify(started)}`);

  let seen = null;
  let failure = null;
  const deadline = Date.now() + DELIVERY_BUDGET_MS;
  try {
    for (;;) {
      seen = await rpc('verify');
      const state = seen.notification?.state;
      if (seen.delivered) break;
      if (state === 'failed') {
        failure = 'the escalation failed to send';
        break;
      }
      if (Date.now() >= deadline) {
        failure = `not delivered within ${DELIVERY_BUDGET_MS / 60_000} minutes (state ${state ?? 'none'}, push_state ${seen.notification?.push_state ?? 'none'})`;
        break;
      }
      await sleep(POLL_MS);
    }
  } catch (error) {
    failure = error.message;
    if (error instanceof Unknown) failure = `UNKNOWN ${failure}`;
  }

  // Always resolve, so a drill never stays escalated.
  let resolveError = null;
  try {
    console.log(`resolve: ${JSON.stringify(await rpc('resolve'))}`);
    const until = Date.now() + RESOLVE_BUDGET_MS;
    for (;;) {
      seen = await rpc('verify');
      if (seen.resolved || Date.now() >= until) break;
      await sleep(5_000);
    }
    if (!seen.resolved) resolveError = 'the resolved event did not move the incident to verifying';
  } catch (error) {
    resolveError = error.message;
  }

  const lines = describe(seen);
  if (failure?.startsWith('UNKNOWN')) finish(3, 'UNKNOWN', [failure, ...(resolveError ? [resolveError] : []), ...lines]);
  if (failure || resolveError || !seen?.pass) {
    finish(1, 'FAIL', [...[failure, resolveError].filter(Boolean), ...lines]);
  }
  finish(0, 'PASS', lines);
}

main().catch((error) => finish(3, 'UNKNOWN', [String(error?.message ?? error)]));
