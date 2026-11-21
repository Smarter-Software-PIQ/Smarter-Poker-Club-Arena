import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { sliceEnclosingBlock } from './helpers/sourceWindow';
import {
  buildEpisodeResolve,
  engineAlertEpisodeId,
  engineAlertMemberKey,
  episodeOf,
} from '../scripts/ci/engine-alert-episode.mjs';
import {
  buildReleaseFailureAlert,
  planReleaseResolutions,
} from '../scripts/ci/record-engine-release-alert.mjs';
import {
  judgeReadback,
  manualResolveEventId,
  planEpisodeResolve,
  validateEpisodeResolveInputs,
} from '../scripts/ci/resolve-engine-alert-episode.mjs';

/**
 * AN ENGINE ALERT RESOLVES ITS OWN EPISODE (incident 484c4cee, 2026-11-21).
 *
 * Reliability intake pairs an appended resolved engine_alerts row with the
 * firing row it resolves ONLY through labels.engine_alert_episode_id and the
 * component (smarter_private.reliability_engine_episode_identity, migration
 * 20261116153859). `EngineReleaseFailed` was raised by
 * scripts/ci/record-engine-release-alert.mjs with no episode, so intake keyed
 * its member by the engine_alerts row id; the correct resolve row 3180 landed
 * on a NEW member, was recorded `resolved_not_of_this_episode`, the incident
 * stayed escalated, and an agent UPDATEd operational_alert_events 446445 by
 * hand to close it. These pins keep every resolve on its own episode, and keep
 * the sanctioned manual path append-only.
 */
const ROOT = process.cwd();
const INTAKE = readFileSync(
  join(
    ROOT,
    'supabase/migrations/20261116153859_engine_alert_episodes_resolve_through_their_original_identit.sql'
  ),
  'utf8'
);
const DELIVERY = readFileSync(join(ROOT, 'server/src/services/engineAlertDelivery.ts'), 'utf8');
const RELEASE_SCRIPT = readFileSync(
  join(ROOT, 'scripts/ci/record-engine-release-alert.mjs'),
  'utf8'
);
const RESOLVE_SCRIPT = readFileSync(
  join(ROOT, 'scripts/ci/resolve-engine-alert-episode.mjs'),
  'utf8'
);
const TRIAGE_WF = parse(
  readFileSync(join(ROOT, '.github/workflows/triage-engine-release-incident.yml'), 'utf8')
);

const INCIDENT = {
  id: '484c4cee-5b54-4bbd-bbf1-3b6ebdcc2c4c',
  source: 'engine-alerts',
  status: 'escalated',
};
const NOTE = 'e2140d2d was sealed by sibling run 44841245126; this failure was a redelivery.';

function failure(runId = '44841264851-1') {
  const alert = buildReleaseFailureAlert({
    SHIPPED: 'false',
    RELEASE_RESULT: 'not completed',
    RUN_ID: runId,
    TARGET_SHA: 'e2140d2d1581daaf84857d98e671f2be832162c6',
    EXIT_STAGE: 'prepare',
    EXIT_OUTCOME: 'failure',
  });
  if (!alert) throw new Error('expected a failure alert');
  return alert;
}

/** The engine_alerts row fn_record_engine_alerts writes for an alert. */
function stored(alert: ReturnType<typeof failure>, id: number) {
  return {
    id,
    fingerprint: alert.fingerprint,
    alertname: alert.labels.alertname,
    component: alert.labels.component,
    severity: alert.labels.severity,
    status: alert.status,
    labels: alert.labels,
    starts_at: alert.startsAt,
  };
}

describe('an engine alert resolves its own episode', () => {
  it('the helper derives the same member key intake derives', () => {
    // The exact key expression in reliability_engine_episode_identity.
    expect(INTAKE).toContain(
      "'engine-alerts:'||p_alertname||':'||component||':episode:'||lower(episode)"
    );
    const ep = engineAlertEpisodeId('x');
    expect(
      engineAlertMemberKey({
        alertname: 'A',
        component: 'c',
        labels: { alertname: 'A', engine_alert_episode_id: ep.toUpperCase() },
      })
    ).toBe(`engine-alerts:A:c:episode:${ep}`);
    expect(
      episodeOf({ engine_alert_episode_id: '00000000-0000-0000-0000-000000000000' })
    ).toBeNull();
    expect(engineAlertMemberKey({ alertname: 'A', component: 'c', labels: {} })).toBeNull();
  });

  it('a release failure is raised with a stable producer episode', () => {
    const a = failure();
    expect(episodeOf(a.labels)).toBe(engineAlertEpisodeId('engine-release-failed:44841264851-1'));
    expect(failure().labels.engine_alert_episode_id).toBe(a.labels.engine_alert_episode_id);
    expect(failure('2-1').labels.engine_alert_episode_id).not.toBe(
      a.labels.engine_alert_episode_id
    );
    expect(engineAlertMemberKey(stored(a, 3171))).not.toBeNull();
  });

  it('the verified-ship resolve lands on the firing row member, and never sends an episode-less resolve', () => {
    const a = failure();
    const legacy = {
      ...stored(a, 3100),
      fingerprint: 'engine-release-failed:1-1',
      labels: { alertname: 'EngineReleaseFailed', component: 'engine-release' },
    };
    const plan = planReleaseResolutions(
      { SHIPPED: 'true', VERIFIED: 'true', RUN_ID: '9-1', TARGET_SHA: 'b'.repeat(40) },
      [stored(a, 3171), legacy]
    );
    expect(plan.resolved).toHaveLength(1);
    expect(plan.unresolvable).toEqual(['engine-release-failed:1-1']);
    const r = plan.resolved[0];
    expect(r.status).toBe('resolved');
    expect(
      engineAlertMemberKey({ ...r, alertname: r.labels.alertname, component: r.labels.component })
    ).toBe(engineAlertMemberKey(stored(a, 3171)));
    expect(r.startsAt).toBe(a.startsAt);
    expect(r.fingerprint).toBe(a.fingerprint);
    // The open-row query reads a column engine_alerts actually has.
    expect(RELEASE_SCRIPT).not.toMatch(/created_at\s*>=|ORDER BY fingerprint, created_at/);
    expect(RELEASE_SCRIPT).toContain("received_at >= now() - interval '14 days'");
  });

  it('the engine journal resolve carries the firing episode', () => {
    // The resolved alert object in the journal's recovery branch.
    const resolvedAlert = sliceEnclosingBlock(DELIVERY, 'endsAt: observedAt');
    expect(resolvedAlert).toContain("status: 'resolved'");
    expect(resolvedAlert).toContain('engine_alert_episode_id: active.episodeId');
    expect(resolvedAlert).toContain('component: active.component');
  });

  it('no extra label can override the identity a resolve copies', () => {
    const a = stored(failure(), 3171);
    const r = buildEpisodeResolve(a, {
      extraLabels: {
        engine_alert_episode_id: engineAlertEpisodeId('other'),
        component: 'x',
        alertname: 'Y',
      },
    });
    expect(r?.labels.engine_alert_episode_id).toBe(a.labels.engine_alert_episode_id);
    expect(r?.labels.component).toBe('engine-release');
    expect(r?.labels.alertname).toBe('EngineReleaseFailed');
  });
});

describe('the sanctioned manual resolve is append-only and refuses what it cannot resolve', () => {
  const a = failure();
  const row = stored(a, 3171);
  const member = {
    member_key: engineAlertMemberKey(row),
    status: 'firing',
    episode: episodeOf(a.labels),
  };

  it('validates its inputs', () => {
    expect(() =>
      validateEpisodeResolveInputs({ incidentId: 'x', note: NOTE, agentSession: 's' })
    ).toThrow(/UUID/);
    expect(() =>
      validateEpisodeResolveInputs({ incidentId: INCIDENT.id, note: 'short', agentSession: 's' })
    ).toThrow(/resolution_note/);
    expect(() =>
      validateEpisodeResolveInputs({ incidentId: INCIDENT.id, note: NOTE, agentSession: ' ' })
    ).toThrow(/agent_session/);
  });

  it('refuses another family, a closed incident, no open firing member, and episode-less members', () => {
    const base = { members: [member], firingRows: [row], note: NOTE, agentSession: 's' };
    expect(planEpisodeResolve({ ...base, incident: null }).refusal).toBe('incident_not_found');
    expect(
      planEpisodeResolve({ ...base, incident: { ...INCIDENT, source: 'alertmanager' } }).refusal
    ).toBe('not_engine_alerts_family');
    expect(
      planEpisodeResolve({ ...base, incident: { ...INCIDENT, status: 'closed' } }).refusal
    ).toBe('incident_closed');
    expect(planEpisodeResolve({ ...base, incident: INCIDENT, members: [] }).refusal).toBe(
      'no_open_firing_member'
    );
    const legacy = planEpisodeResolve({
      ...base,
      incident: INCIDENT,
      members: [
        {
          member_key: 'engine-alerts:EngineReleaseFailed:3171',
          status: 'firing',
          episode: 'row:446445',
        },
      ],
    });
    expect(legacy.refusal).toBe('no_member_carries_an_episode');
    expect(legacy.unresolvable?.[0].reason).toBe('member_has_no_producer_episode');
  });

  it('appends a resolve that copies the firing row identity, once per episode', () => {
    const plan = planEpisodeResolve({
      incident: INCIDENT,
      members: [member],
      firingRows: [row],
      note: NOTE,
      agentSession: 's',
    });
    expect(plan.refusal).toBeUndefined();
    const r = plan.alerts![0];
    expect(r.status).toBe('resolved');
    expect(r.fingerprint).toBe(row.fingerprint);
    expect(r.startsAt).toBe(row.starts_at);
    expect(
      engineAlertMemberKey({ ...r, alertname: r.labels.alertname, component: r.labels.component })
    ).toBe(member.member_key);
    expect(r.labels.engine_alert_event_id).toBe(manualResolveEventId(member.episode));
    expect(r.labels.resolves_engine_alert_id).toBe('3171');
    expect(r.annotations.description).toBe(NOTE);
  });

  it('judges intake readback: only a resolved member counts', () => {
    expect(
      judgeReadback(
        [{ id: 1 }],
        [{ engine_alert_id: '1', disposition: 'resolved_not_of_this_episode' }]
      ).failed
    ).toHaveLength(1);
    expect(judgeReadback([{ id: 1 }], []).failed).toHaveLength(1);
    expect(
      judgeReadback([{ id: 1 }], [{ engine_alert_id: '1', disposition: 'recovered' }]).ok
    ).toHaveLength(1);
  });

  it('never UPDATEs or DELETEs, and is reachable only by manual dispatch', () => {
    expect(RESOLVE_SCRIPT).not.toMatch(/\b(UPDATE|DELETE\s+FROM|TRUNCATE)\b/);
    expect(RESOLVE_SCRIPT).toContain('public.fn_record_engine_alerts');
    expect(Object.keys(TRIAGE_WF.on)).toEqual(['workflow_dispatch']);
    expect(TRIAGE_WF.on.workflow_dispatch.inputs.operation.options).toContain('resolve');
  });

  it('no script or workflow rewrites an alert row instead', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === 'node_modules' || name === 'fixtures') continue;
          walk(p);
        } else if (/\.(mjs|js|cjs|ts|sh|ya?ml)$/.test(name) && !/^test-|\.test\./.test(name)) {
          const text = readFileSync(p, 'utf8');
          if (
            /\b(UPDATE|DELETE\s+FROM)\s+(public\.)?(engine_alerts|operational_alert_events)\b/i.test(
              text
            )
          ) {
            offenders.push(relative(ROOT, p));
          }
        }
      }
    };
    walk(join(ROOT, 'scripts'));
    walk(join(ROOT, '.github'));
    expect(offenders).toEqual([]);
  });
});
