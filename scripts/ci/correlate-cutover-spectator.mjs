// The original transaction already owns release admission, replacement and sealing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function correlateSpectator(receipt, witness, runId) {
  assert.match(runId, /^[1-9]\d*-[1-9]\d*$/);
  assert.equal(receipt.runId, runId);
  assert.equal(witness.runId, runId);
  assert.equal(receipt.result, 'sealed');
  assert.match(receipt.sha, /^[0-9a-f]{40}$/);
  assert.equal(witness.target, receipt.sha);
  assert.match(witness.predecessor, /^[0-9a-f]{40}$/);
  assert.notEqual(witness.predecessor, receipt.sha);
  assert.match(receipt.instanceId, /^[1-9]\d*-[0-9a-f]{8}$/);
  assert.equal(receipt.completionRuntime?.instanceId, receipt.instanceId);
  assert.equal(witness.afterInstance, receipt.instanceId);
  assert.match(witness.beforeInstance, /^[1-9]\d*-[0-9a-f]{8}$/);
  assert.notEqual(witness.beforeInstance, receipt.instanceId);
  assert.equal(witness.sameAuthenticatedSpectator, true);
  assert.match(witness.tableId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.ok(Number.isSafeInteger(witness.handNumber) && witness.handNumber > 0);
  const started = Date.parse(receipt.startedAt);
  const committed = Date.parse(witness.committedAt);
  for (const timestamp of [
    witness.armedAt,
    witness.freeze,
    witness.thaw,
    witness.restoredAt,
    started,
    committed,
  ]) {
    assert.ok(Number.isSafeInteger(timestamp) && timestamp > 0);
  }
  assert.ok(
    witness.armedAt < witness.freeze && witness.freeze <= started && started <= witness.thaw
  );
  assert.ok(
    started <= witness.restoredAt && witness.restoredAt <= committed && witness.thaw <= committed
  );
  return { ...witness, fixtureCleanupVerified: true, containerStartedAt: receipt.startedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    JSON.stringify(
      correlateSpectator(
        JSON.parse(process.env.SEALED_RECEIPT),
        JSON.parse(process.env.SPECTATOR),
        `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
      )
    )
  );
}
