/**
 * AN ENGINE ALERT RESOLVES ITS OWN EPISODE (incident 484c4cee, 2026-11-21).
 *
 * public.engine_alerts is append-only: a firing row and the row that resolves
 * it are two different rows. Reliability intake
 * (smarter_private.reliability_ingest_alert, ENGINE_EPISODE_IDENTITY_V1) can
 * pair them only through the producer's episode:
 *
 *   member_key = 'engine-alerts:' || alertname || ':' || component
 *                || ':episode:' || labels.engine_alert_episode_id
 *
 * A row with no valid engine_alert_episode_id falls back to a member keyed by
 * its own engine_alerts id, so no later row can ever resolve it: the resolve
 * lands on a new member and is recorded `resolved_not_of_this_episode`. That
 * is what kept 484c4cee escalated after a correct resolve row was appended,
 * and what forced a hand UPDATE of operational_alert_events 446445.
 *
 * So every producer outside the engine journal (which already carries
 * episodes, server/src/services/engineAlertDelivery.ts) builds its firing row
 * with an episode, and every resolve is built FROM the firing row it resolves
 * with this module, copying alertname, component, fingerprint, startsAt and
 * engine_alert_episode_id exactly.
 */
import { createHash } from 'node:crypto';

export const EPISODE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL = '00000000-0000-0000-0000-000000000000';
const COMPONENT_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

/** A deterministic RFC 4122 shaped UUID (version 5 bits) from a seed. */
export function deterministicUuid(seed) {
  const h = createHash('sha256').update(String(seed)).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** The producer episode of one alert fingerprint (stable across retries). */
export function engineAlertEpisodeId(fingerprint) {
  return deterministicUuid(`engine-alert-episode:${fingerprint}`);
}

/** The episode intake will read from these labels, or null when it reads none. */
export function episodeOf(labels) {
  const ep = labels && typeof labels === 'object' ? labels.engine_alert_episode_id : null;
  return typeof ep === 'string' && EPISODE_RE.test(ep) && ep !== NIL ? ep.toLowerCase() : null;
}

/** The reliability member key intake derives for an engine_alerts row, or null. */
export function engineAlertMemberKey(row) {
  const labels = row?.labels && typeof row.labels === 'object' ? row.labels : {};
  const episode = episodeOf(labels);
  const alertname = row?.alertname || labels.alertname;
  const component = row?.component || labels.component;
  if (!episode || typeof alertname !== 'string' || !alertname) return null;
  if (typeof component !== 'string' || !COMPONENT_RE.test(component)) return null;
  if (labels.alertname !== undefined && labels.alertname !== alertname) return null;
  return `engine-alerts:${alertname}:${component}:episode:${episode}`;
}

const iso = (value, fallback) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))) {
    return value.trim();
  }
  return fallback;
};

/**
 * Build the resolved alert for one firing engine_alerts row. Returns null when
 * the row carries no episode intake can match: appending a resolve for it
 * would only record `resolved_not_of_this_episode`, so none is built.
 *
 * `row` is an engine_alerts row (fingerprint, alertname, component, severity,
 * labels, starts_at). `extraLabels` may add evidence labels; it can never
 * override the identity labels.
 */
export function buildEpisodeResolve(row, { summary, description, extraLabels = {}, now } = {}) {
  if (!engineAlertMemberKey(row)) return null;
  const fingerprint = typeof row.fingerprint === 'string' ? row.fingerprint.trim() : '';
  if (!fingerprint) return null;
  const labels = row.labels;
  const alertname = row.alertname || labels.alertname;
  const component = row.component || labels.component;
  const nowIso = iso(now, new Date().toISOString());
  return {
    status: 'resolved',
    fingerprint,
    startsAt: iso(row.starts_at ?? row.startsAt, nowIso),
    endsAt: nowIso,
    labels: {
      ...labels,
      ...extraLabels,
      alertname,
      component,
      severity: labels.severity || row.severity || 'warning',
      engine_alert_episode_id: episodeOf(labels),
    },
    annotations: {
      summary: String(summary || `${alertname} resolved`).slice(0, 500),
      description: String(description || '').slice(0, 2000),
    },
  };
}
