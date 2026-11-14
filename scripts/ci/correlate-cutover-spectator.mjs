// The original transaction already owns release admission, replacement and sealing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readNotObserved, SPECTATOR_NOT_OBSERVED_EXIT } from './cutover-spectator-admission.mjs';

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
  // Armed while the predecessor dealt, or inside its announced last hand.
  // Either way the ordering below still requires armedAt before the freeze.
  assert.ok(['idle', 'last_hand'].includes(witness.armedPhase));
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

/**
 * Three outcomes, never two (CLAUDE.md 10.86):
 *   sealed        - a witness exists and matches the sealed receipt;
 *   not-observed  - no witness, and this attempt's spectator recorded that it
 *                   arrived after the freeze began. Never a sealed artifact;
 *   (throws)      - anything else, including a witness beside a late record.
 */
export function spectatorOutcome({ receipt, witness, notObserved, runId }) {
  const late = readNotObserved(notObserved, runId);
  if (witness) {
    assert.equal(notObserved || '', '', 'a witness and a not-observed record contradict');
    return {
      outcome: 'sealed',
      sealed: correlateSpectator(JSON.parse(receipt), JSON.parse(witness), runId),
    };
  }
  assert.ok(late, 'the spectator left neither a witness nor a not-observed record');
  return { outcome: 'not-observed', record: late };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spectatorOutcome({
    receipt: process.env.SEALED_RECEIPT,
    witness: process.env.SPECTATOR,
    notObserved: process.env.SPECTATOR_NOT_OBSERVED,
    runId: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
  });
  if (result.outcome === 'sealed') console.log(JSON.stringify(result.sealed));
  else {
    console.log(JSON.stringify(result.record));
    process.exitCode = SPECTATOR_NOT_OBSERVED_EXIT;
  }
}
