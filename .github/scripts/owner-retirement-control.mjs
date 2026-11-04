import fs from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = fs.readFileSync(
  new URL(
    '../../scripts/ci/fixtures/tournament-abort/owner-retirement-nov2-manifest.json',
    import.meta.url
  )
);
const manifest = JSON.parse(bytes);
const additionalBytes = fs.readFileSync(
  new URL(
    '../../scripts/ci/fixtures/tournament-abort/owner-closeout-nov3-additional.json',
    import.meta.url
  )
);
const additional = JSON.parse(additionalBytes);
const targets = [...manifest.targets, ...additional.targets];
const manifestHash = createHash('sha256').update(bytes).update(additionalBytes).digest('hex');
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const OWNER_ACTIONS = ['owner_request', 'owner_read', 'owner_ack'];
export function ownerRetirementIntent(input) {
  const member = targets.find((r) => r.tournament_id === input.tournamentId);
  if (
    !OWNER_ACTIONS.includes(input.action) ||
    !member ||
    manifest.targets.length !== 140 ||
    additional.targets.length !== 5 ||
    targets.length !== 145 ||
    new Set(targets.map((r) => r.tournament_id)).size !== 145 ||
    additional.cutoff_utc !== '2026-11-02T20:31:18.761336Z' ||
    new Set(manifest.targets.map((r) => r.tournament_id)).size !== 140 ||
    manifest.preserved_outside_diamond_event_ids.includes(input.tournamentId) ||
    manifest.cutoff_utc !== '2026-11-02T06:00:00Z' ||
    manifest.timezone !== 'America/Chicago' ||
    !UUID.test(input.nonce ?? '') ||
    !UUID.test(input.generation ?? '') ||
    !/^[a-f0-9]{40}$/.test(input.sha ?? '') ||
    input.sha === 'eed06fe51dea622069c661a6213d5b031ff3a9e3' ||
    !/^[1-9][0-9]*-[0-9a-f]{8}$/.test(input.instance ?? '')
  )
    throw Error('Exact Owner Retirement Manifest And Current Runtime Required');
  return {
    action: input.action,
    tournamentId: member.tournament_id,
    operationId: member.original_operation_id,
    originalStartedAt: member.original_started_at,
    manifestHash,
    cutoff: additional.targets.includes(member) ? additional.cutoff_utc : manifest.cutoff_utc,
    financialWriter: manifest.financial_writer,
    nonce: input.nonce,
    generation: input.generation,
    sha: input.sha,
    instance: input.instance,
    disposition: 'no_financial_action',
    reason:
      'Owner-directed old-event closeout November 3 Chicago supersedes human-event preservation; equal-share superseded; retain original operations, player liabilities and prior awards; financial disposition requires separate qualified authority.',
  };
}
// This adapter only drives the existing physical-stop protocol. It has no
// settlement action, wallet path, replay loop, or release capability.
export async function controlOwnerRetirement(
  input,
  { fetchImpl = fetch, serviceIdentity, supabaseUrl } = {}
) {
  const intent = ownerRetirementIntent(input);
  if (!serviceIdentity || supabaseUrl !== 'https://kuklfnapbkmacvwxktbh.supabase.co')
    throw Error('Configured Canonical Service Required');
  const result = { request: intent, outcome: 'unknown' };
  const headers = {
    authorization: `Bearer ${serviceIdentity}`,
    apikey: serviceIdentity,
    'content-type': 'application/json',
  };
  async function request(url, body) {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers,
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) {
      if (value?.code === '55000' && value?.message === 'operator_abort_target_not_owned')
        return { state: 'not_requested' };
      throw Error('Canonical Owner Operation Unreadable');
    }
    return value;
  }
  async function health() {
    const response = await fetchImpl(
      `https://engine.smarter.poker/health?owner_retirement=${Date.now()}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) throw Error('Current Runtime Unreadable');
    const h = await response.json();
    if (
      h.releaseSha !== intent.sha ||
      h.version !== intent.sha.slice(0, 8) ||
      h.instanceId !== intent.instance ||
      h.running !== true ||
      h.status !== 'ok' ||
      h.maintenance?.active !== false ||
      h.maintenance?.phase !== 'idle'
    )
      throw Error('Current Runtime Changed');
    return {
      releaseSha: h.releaseSha,
      instanceId: h.instanceId,
      running: true,
      maintenance: 'idle',
    };
  }
  const ids = { p_operation_id: intent.operationId, p_tournament_id: intent.tournamentId };
  async function read() {
    const value = await request(
      `${supabaseUrl}/rest/v1/rpc/fn_ca_tournament_abort_stop_state`,
      ids
    );
    if (value.state === 'not_requested') return value;
    if (
      value.ok !== true ||
      value.operation_id !== intent.operationId ||
      value.tournament_id !== intent.tournamentId ||
      !['stop_requested', 'quiesced', 'settled'].includes(value.state)
    )
      throw Error('Operation Ownership Changed');
    // Never advance a disposition already committed under any mode.
    if (value.state !== 'settled' && value.current_generation !== intent.generation)
      throw Error('Generation Changed');
    return {
      state: value.state,
      operation_id: value.operation_id,
      tournament_id: value.tournament_id,
      current_generation: UUID.test(value.current_generation ?? '')
        ? value.current_generation
        : null,
      current_boundary_valid: value.current_boundary_valid === true,
      quiescence_generation: UUID.test(value.quiescence_generation ?? '')
        ? value.quiescence_generation
        : null,
      money_hash: /^[a-f0-9]{32}$/.test(value.money_hash ?? '') ? value.money_hash : null,
      receipt_digest: value.receipt
        ? createHash('sha256').update(JSON.stringify(value.receipt)).digest('hex')
        : null,
    };
  }
  try {
    result.before = await health();
    result.canonicalBefore = await read();
    if (result.canonicalBefore.state === 'settled') {
      result.after = await health();
      result.outcome = 'prior_disposition_preserved';
      return result;
    }
    const events = await request(
      `${supabaseUrl}/rest/v1/tournaments?id=eq.${intent.tournamentId}&select=id,started_at,status`
    );
    if (
      !Array.isArray(events) ||
      events.length !== 1 ||
      events[0].id !== intent.tournamentId ||
      Date.parse(events[0].started_at) !== Date.parse(intent.originalStartedAt) ||
      !['RUNNING', 'BREAK', 'LATE_REG'].includes(events[0].status)
    )
      throw Error('Original Event Identity Changed');
    let attempted = false;
    try {
      if (input.action === 'owner_request' && result.canonicalBefore.state === 'not_requested') {
        const leases = await request(
          `${supabaseUrl}/rest/v1/engine_tournament_leases?tournament_id=eq.${intent.tournamentId}&select=lease_generation,protocol_version,heartbeat_at`
        );
        const age = Date.now() - Date.parse(leases?.[0]?.heartbeat_at);
        if (
          !Array.isArray(leases) ||
          leases.length !== 1 ||
          leases[0].lease_generation !== intent.generation ||
          leases[0].protocol_version !== 2 ||
          !Number.isFinite(age) ||
          age < -5000 ||
          age > 30000
        )
          throw Error('Current Lease Changed');
        attempted = true;
        const r = await request(`${supabaseUrl}/rest/v1/rpc/fn_ca_request_tournament_abort`, {
          p_operation_id: intent.operationId,
          p_tournament_ids: [intent.tournamentId],
          p_reason: intent.reason,
        });
        if (
          r.ok !== true ||
          r.operation_id !== intent.operationId ||
          r.stop_requested !== true ||
          JSON.stringify(r.tournament_ids) !== JSON.stringify([intent.tournamentId])
        )
          throw Error('Request Acknowledgement Unknown');
      } else if (input.action === 'owner_ack') {
        if (result.canonicalBefore.state === 'not_requested') throw Error('Stop Not Requested');
        attempted = true;
        const r = await request('https://engine.smarter.poker/admin/tournament-abort-boundary', {
          operationId: intent.operationId,
          tournamentId: intent.tournamentId,
        });
        if (r.success !== true || r.runtime?.operation_id !== intent.operationId)
          throw Error('Boundary Acknowledgement Unknown');
      }
    } catch {
      if (attempted) result.mutationAcknowledgement = 'unknown';
      else throw Error('Prewrite Evidence Missing');
    }
    result.canonicalAfter = await read();
    result.after = await health();
    if (result.mutationAcknowledgement) return result;
    if (input.action === 'owner_read') result.outcome = 'owner_stop_readback';
    else if (
      input.action === 'owner_request' &&
      ['stop_requested', 'quiesced'].includes(result.canonicalAfter.state)
    )
      result.outcome = attempted ? 'owner_stop_requested' : 'owner_stop_already_requested';
    else if (
      input.action === 'owner_ack' &&
      result.canonicalAfter.state === 'quiesced' &&
      result.canonicalAfter.current_boundary_valid &&
      result.canonicalAfter.quiescence_generation === intent.generation
    )
      result.outcome = 'owner_boundary_verified';
  } catch {
    result.reason = 'Read Same Operation And Resolve Evidence Before Any Repeat';
  }
  return result;
}
