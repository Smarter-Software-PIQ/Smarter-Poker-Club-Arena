import fs from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = fs.readFileSync(
  new URL(
    '../../scripts/ci/fixtures/tournament-abort/owner-closeout-nov3-additional.json',
    import.meta.url
  )
);
const manifest = JSON.parse(bytes);
const original = JSON.parse(
  fs.readFileSync(
    new URL(
      '../../scripts/ci/fixtures/tournament-abort/owner-retirement-nov2-manifest.json',
      import.meta.url
    )
  )
);
export const ADDITIONAL_REFUND_ACTIONS = ['additional_refund_read', 'additional_refund_settle'];
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// This exact manifest is outside the 140-event bank-retirement disposition.
// Physical stopping remains owner_request/owner_ack. No new stop or payer exists here.
export function additionalRefundIntent(input) {
  const member = manifest.targets.find((r) => r.tournament_id === input.tournamentId);
  if (
    !ADDITIONAL_REFUND_ACTIONS.includes(input.action) ||
    !member ||
    member.asset !== 'chips' ||
    manifest.targets.length !== 5 ||
    new Set(manifest.targets.map((r) => r.tournament_id)).size !== 5 ||
    manifest.targets.some((r) =>
      original.targets.some((old) => old.tournament_id === r.tournament_id)
    ) ||
    manifest.cutoff_utc !== '2026-11-02T20:31:18.761336Z' ||
    !uuid.test(member.original_operation_id) ||
    !uuid.test(input.nonce ?? '') ||
    !uuid.test(input.generation ?? '') ||
    !/^[a-f0-9]{40}$/.test(input.sha ?? '') ||
    input.sha === 'eed06fe51dea622069c661a6213d5b031ff3a9e3' ||
    !/^[1-9][0-9]*-[0-9a-f]{8}$/.test(input.instance ?? '') ||
    (input.action === 'additional_refund_settle' && !/^[a-f0-9]{32}$/.test(input.moneyHash ?? ''))
  )
    throw Error('Exact Additional Five Original Refund Identity Required');
  return {
    action: input.action,
    tournamentId: member.tournament_id,
    operationId: member.original_operation_id,
    nonce: input.nonce,
    generation: input.generation,
    sha: input.sha,
    instance: input.instance,
    ...(input.action === 'additional_refund_settle' ? { moneyHash: input.moneyHash } : {}),
    manifestHash: createHash('sha256').update(bytes).digest('hex'),
    closureMode: 'started_operator_abort',
  };
}
