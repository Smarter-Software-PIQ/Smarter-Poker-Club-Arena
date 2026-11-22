/**
 * THE ONE SANCTIONED WAY TO RESOLVE AN ENGINE-ALERTS INCIDENT BY HAND
 * (incident 484c4cee, 2026-11-21).
 *
 * Given a reliability incident id and a resolution note, this reads the
 * incident's open firing members, finds the engine_alerts row each one fired
 * from, and appends ONE resolved engine_alerts row per member through
 * public.fn_record_engine_alerts, copying the firing row's exact alertname,
 * component, fingerprint, startsAt and labels.engine_alert_episode_id
 * (buildEpisodeResolve). Intake then resolves the member through its normal
 * path (ENGINE_EPISODE_IDENTITY_V1), exactly as if the producer had resolved
 * it itself.
 *
 * It never UPDATEs or DELETEs an alert row, an inbox row, an observation or an
 * incident. It refuses when the incident is not engine-alerts family, is
 * closed, has no open firing member, or none of its members carries an
 * episode intake can match. Each episode gets at most one manual resolve: its
 * engine_alert_event_id is derived from the episode, so a second, different
 * request for the same episode is refused by fn_record_engine_alerts (23505).
 *
 * After the write it reads back the intake disposition of every row it
 * appended and exits non-zero unless each one resolved its member.
 *
 * Runs only through the `resolve` operation of
 * .github/workflows/triage-engine-release-incident.yml, whose database
 * identity is the repository secret (CLAUDE.md 1.2.5). There is no other
 * caller and nothing schedules it.
 */
import {
  buildEpisodeResolve,
  deterministicUuid,
  engineAlertMemberKey,
  EPISODE_RE,
} from './engine-alert-episode.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ENGINE_ALERTS_FAMILY = 'engine-alerts';

export function validateEpisodeResolveInputs({ incidentId, note, agentSession }) {
  const id = String(incidentId ?? '').trim();
  if (!UUID_RE.test(id)) throw new Error('incident_id must be a valid UUID');
  const text = String(note ?? '').trim();
  if (text.length < 10 || text.length > 1000) {
    throw new Error('resolution_note must be 10 to 1000 characters and say why it is resolved');
  }
  const session = String(agentSession ?? '').trim();
  if (!session || session.length > 160) {
    throw new Error('agent_session must be a non-empty string (<= 160 chars)');
  }
  return { incidentId: id, note: text, agentSession: session };
}

/** The engine_alert_event_id of the one manual resolve an episode may have. */
export function manualResolveEventId(episode) {
  return deterministicUuid(`engine-alert-manual-resolve:${String(episode).toLowerCase()}`);
}

/**
 * Pure plan. `incident` is the reliability_incidents row, `members` its open
 * firing members, `firingRows` the engine_alerts firing rows that carry any of
 * those members' episodes. Returns { refusal, detail } or
 * { alerts, unresolvable }.
 */
export function planEpisodeResolve({ incident, members, firingRows, note, agentSession, now }) {
  if (!incident) return { refusal: 'incident_not_found' };
  if (incident.source !== ENGINE_ALERTS_FAMILY) {
    return { refusal: 'not_engine_alerts_family', detail: incident.source ?? null };
  }
  if (incident.status === 'closed') return { refusal: 'incident_closed' };
  const open = (Array.isArray(members) ? members : []).filter((m) => m && m.status === 'firing');
  if (open.length === 0) return { refusal: 'no_open_firing_member' };

  const alerts = [];
  const unresolvable = [];
  for (const member of open) {
    const episode = typeof member.episode === 'string' ? member.episode.toLowerCase() : '';
    if (!EPISODE_RE.test(episode)) {
      // Keyed by its own row id (no producer episode): no appended row can
      // ever land on this member. Named, never papered over.
      unresolvable.push({
        member_key: member.member_key,
        reason: 'member_has_no_producer_episode',
      });
      continue;
    }
    const row = (Array.isArray(firingRows) ? firingRows : [])
      .filter((r) => r && r.status === 'firing' && engineAlertMemberKey(r) === member.member_key)
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (!row) {
      unresolvable.push({ member_key: member.member_key, reason: 'firing_row_not_found' });
      continue;
    }
    const alert = buildEpisodeResolve(row, {
      summary: `${row.alertname} resolved by hand (${agentSession})`,
      description: note,
      extraLabels: {
        resolved_by: 'resolve-engine-alert-episode',
        resolved_by_session: agentSession,
        resolved_incident_id: incident.id,
        resolves_engine_alert_id: String(row.id),
      },
      now,
    });
    if (!alert) {
      unresolvable.push({ member_key: member.member_key, reason: 'firing_row_has_no_episode' });
      continue;
    }
    alert.labels.engine_alert_event_id = manualResolveEventId(episode);
    alerts.push(alert);
  }
  if (alerts.length === 0) return { refusal: 'no_member_carries_an_episode', unresolvable };
  return { alerts, unresolvable };
}

/** Did intake resolve each appended row's member? */
export function judgeReadback(receipts, dispositions) {
  const ok = [];
  const failed = [];
  for (const receipt of receipts) {
    const d = dispositions.find((x) => String(x.engine_alert_id) === String(receipt.id));
    const disposition = d?.disposition ?? null;
    if (
      disposition &&
      disposition !== 'resolved_not_of_this_episode' &&
      disposition !== 'resolution_order_unknown' &&
      disposition !== 'resolved_older_episode' &&
      disposition !== 'resolved_already'
    ) {
      ok.push({ engine_alert_id: receipt.id, disposition });
    } else {
      failed.push({ engine_alert_id: receipt.id, disposition });
    }
  }
  return { ok, failed };
}

export async function resolveEngineAlertEpisode(client, inputs, now = new Date()) {
  const { incidentId, note, agentSession } = validateEpisodeResolveInputs(inputs);
  const { rows: incRows } = await client.query(
    `SELECT id::text AS id, fingerprint, source, status, opened_at
       FROM smarter_private.reliability_incidents WHERE id = $1::uuid`,
    [incidentId]
  );
  const incident = incRows[0] ?? null;
  let members = [];
  let firingRows = [];
  if (incident && incident.source === ENGINE_ALERTS_FAMILY && incident.status !== 'closed') {
    ({ rows: members } = await client.query(
      `SELECT member_key, status, episode
         FROM smarter_private.reliability_alert_members
        WHERE fingerprint = $1 AND status = 'firing' AND last_firing_at >= $2
        ORDER BY member_key LIMIT 200`,
      [incident.fingerprint, incident.opened_at]
    ));
    const episodes = members
      .map((m) => (typeof m.episode === 'string' ? m.episode.toLowerCase() : ''))
      .filter((e) => EPISODE_RE.test(e));
    if (episodes.length > 0) {
      ({ rows: firingRows } = await client.query(
        `SELECT id, fingerprint, alertname, component, severity, status, labels, starts_at
           FROM public.engine_alerts
          WHERE status = 'firing'
            AND lower(labels->>'engine_alert_episode_id') = ANY($1::text[])
          ORDER BY id DESC LIMIT 400`,
        [episodes]
      ));
    }
  }
  const plan = planEpisodeResolve({ incident, members, firingRows, note, agentSession, now });
  if (plan.refusal) return { resolved: false, incidentId, ...plan };

  const { rows } = await client.query(
    'SELECT public.fn_record_engine_alerts($1::jsonb) AS receipts',
    [JSON.stringify(plan.alerts)]
  );
  const receipts = Array.isArray(rows[0]?.receipts) ? rows[0].receipts : [];
  const { rows: dispositions } = await client.query(
    `SELECT e.event_key AS engine_alert_id, o.disposition, o.incident_id::text AS incident_id
       FROM public.operational_alert_events e
       JOIN smarter_private.reliability_observations o ON o.inbox_event_id = e.id
      WHERE e.source LIKE 'engine-alerts%' AND e.event_key = ANY($1::text[])
        AND o.status = 'resolved'`,
    [receipts.map((r) => String(r.id))]
  );
  const verdict = judgeReadback(receipts, dispositions);
  const { rows: after } = await client.query(
    `SELECT status FROM smarter_private.reliability_incidents WHERE id = $1::uuid`,
    [incidentId]
  );
  return {
    resolved: verdict.failed.length === 0 && receipts.length === plan.alerts.length,
    incidentId,
    appended: receipts,
    readback: verdict,
    unresolvable: plan.unresolvable,
    incidentStatusAfter: after[0]?.status ?? null,
  };
}
