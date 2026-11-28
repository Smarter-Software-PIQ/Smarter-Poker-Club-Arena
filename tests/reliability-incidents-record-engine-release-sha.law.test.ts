/**
 * LAW: RELIABILITY INCIDENTS RECORD LIVE ENGINE releaseSha ON OBSERVATIONS AND RECOVERY
 * (2026-11-28).
 *
 * Production audit on 2026-11-28 showed `smarter_private.reliability_incidents.engine_release`
 * was NULL on every financial-alerts incident (including fn_ca_hand_gap_watch 1e532243) and
 * every engine-alerts incident (including ClubArenaStatsIndexLag eb6f18a7):
 *   1. operational_source_intake wraps captured rows under payload->'original_event',
 *      which reliability_ingest_alert never inspected for releaseSha/engine_release.
 *   2. reliability_apply_signal never updated engine_release on resolved/recovery signals
 *      or backfilled NULL engine_release on non-fresh observations.
 *   3. fn_ca_hand_gap_watch never stamped hand_history.engine_build into opened or
 *      auto-resolved financial_alerts rows.
 *   4. EngineAlertDelivery never stamped GIT_COMMIT_SHA as labels.engine_release.
 *
 * Migration 20261128074415_reliability_incidents_record_engine_release_sha.sql and
 * server/src/services/engineAlertDelivery.ts close all four paths permanently.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIG_FILE = '20261128074415_reliability_incidents_record_engine_release_sha.sql';
const MIG = readFileSync(join(ROOT, 'supabase', 'migrations', MIG_FILE), 'utf8');
const DELIVERY = readFileSync(
  join(ROOT, 'server', 'src', 'services', 'engineAlertDelivery.ts'),
  'utf8'
);

describe('reliability incidents record live engine releaseSha on observations and recovery', () => {
  it('patches reliability_ingest_alert, reliability_apply_signal and fn_ca_hand_gap_watch by exact preimage in one bounded transaction', () => {
    expect((MIG.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((MIG.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(MIG).toContain("SET LOCAL lock_timeout = '3s';");
    expect(MIG).not.toMatch(/ALTER TABLE public\.(hand_history|tables|clubs|tournaments)\b/);
    expect(MIG).toContain("IF md5(v_def) <> '41548fbfd18a2f04ed9028cd44c78b8b' THEN");
    expect(MIG).toContain("IF md5(v_def) <> '22fd63bb07ecb155a11bb1d1e099ff79' THEN");
    expect(MIG).toContain("IF md5(v_def) <> '186ba323508b3419241974e34bf8e54e' THEN");
  });

  it('extracts nested financial_alerts and engine_alerts releaseSha in reliability_ingest_alert', () => {
    expect(MIG).toContain(
      "smarter_private.reliability_payload_id(v_labels, p_payload, ''releaseSha'')"
    );
    expect(MIG).toContain(
      "smarter_private.reliability_payload_id(v_labels, p_payload, ''engine_release'')"
    );
    expect(MIG).toContain(
      "smarter_private.reliability_payload_id(v_labels, p_payload, ''engine_build'')"
    );
    expect(MIG).toContain("p_payload#>>ARRAY[''original_event'',''labels'',''engine_release'']");
  });

  it('records engine_release on resolved/recovery signals and preserves lock order in reliability_apply_signal', () => {
    expect(MIG).toContain('engine_release = coalesce(p_engine_release, engine_release),');
    expect(MIG).toContain('engine_release = coalesce(engine_release, p_engine_release),');
    expect(MIG).toContain("''engine_release'', p_engine_release");
    expect(MIG).toContain('ONE INCIDENT, ONE LOCK ORDER');
  });

  it('stamps hand_history.engine_build on fn_ca_hand_gap_watch open and resolve without direct notifications', () => {
    expect(MIG).toContain('FROM public.hand_history h');
    expect(MIG).toContain("AND h.engine_build ~ ''^[0-9a-f]{40}$''");
    expect(MIG).toContain("''resolved_release_sha'', v_release_sha,");
    expect(MIG).toContain("''releaseSha'', v_release_sha,");
    expect(MIG).not.toMatch(/fn_raise_notification|push_outbox|ca_incident_recipients/);
  });

  it('revokes browser execution, includes a rolled-back behavioral probe, and declares @live-proof', () => {
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.reliability_ingest_alert(bigint, text, text, text, text, text, jsonb, timestamptz, timestamptz, bigint, text, text) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.reliability_apply_signal(text, boolean, text, text, text, text, text, text, jsonb, jsonb, text, text, boolean, timestamptz, bigint, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_hand_gap_watch(timestamptz) FROM PUBLIC, anon, authenticated;'
    );
    expect(MIG).toContain("RAISE EXCEPTION 'probe-unwind'");
    expect(MIG).toMatch(/^-- @live-proof: \(SELECT /m);
  });

  it('wires resolveReleaseIdentity().releaseSha into EngineAlertDelivery for firing and resolved alerts', () => {
    expect(DELIVERY).toContain('resolveReleaseIdentity');
    expect(DELIVERY).toContain('engine_release: engineRelease');
  });
});
