import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIntake, TARGET } from './core.mjs';
import {
  createNativeTurnProbe,
  lastRecordEndsTurnAfter,
  USAGE_LIMIT_HOLD_MS,
  uuidV7Millis,
} from './native-turn.mjs';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const OP = '00000000-0000-4000-8000-000000000001';
// UUIDv7 message id minted at 2026-11-14T01:15:30Z.
const MSG = `${(1794618930000)
  .toString(16)
  .padStart(12, '0')
  .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-000000000003`;
const requested = {
  operationId: OP,
  ids: [A, B],
  phase: 'queued',
  messageId: MSG,
  wake: 'requested',
};
const ended = (startedAt) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      started_at: startedAt,
      error: { message: 'Fatal error: application network permission was revoked' },
    },
  });

test('a requested operation whose native turn ended is released and its unread IDs queued once', async () => {
  let saved = structuredClone(requested);
  const queued = [];
  const intake = createIntake({
    load: async () => saved,
    save: async (value) => {
      saved = value;
    },
    pending: async () => ({ version: 1, active_acknowledged: false, pending: [B, C] }),
    queue: async (args) => {
      queued.push(args);
      return `Queued message ${'00000000-0000-4000-8000-0000000000ff'} for thread ${TARGET}.`;
    },
    wake: async () => {},
    nativeTurnEnded: async (active) => active.messageId === MSG,
  });
  await intake.event();
  assert.equal(queued.length, 1);
  assert.match(queued[0].at(-1), new RegExp(`${B}, ${C}`));
  assert.deepEqual(saved.ids, [B, C]);
  assert.equal(saved.wake, 'requested');
  assert.equal(intake.status().haltedReleases, 1);
});

test('without proof of an ended turn the requested operation is retained and nothing is queued', async () => {
  for (const proof of [undefined, async () => false, async () => 'yes']) {
    let saved = structuredClone(requested);
    let queued = 0;
    const intake = createIntake({
      load: async () => saved,
      save: async (value) => {
        saved = value;
      },
      pending: async () => ({ version: 1, active_acknowledged: false, pending: [B, C] }),
      queue: async () => {
        queued++;
        throw new Error('no queue authorized');
      },
      wake: async () => {
        throw new Error('no second wake authorized');
      },
      nativeTurnEnded: proof,
    });
    await intake.event();
    assert.equal(queued, 0);
    assert.deepEqual(saved, requested);
  }
});

test('an uncertain wake is never released by the turn probe', async () => {
  let saved = { ...requested, wake: 'uncertain' };
  let probed = 0;
  const intake = createIntake({
    load: async () => saved,
    save: async (value) => {
      saved = value;
    },
    pending: async () => ({ version: 1, active_acknowledged: false, pending: [B] }),
    queue: async () => {
      throw new Error('no queue authorized');
    },
    nativeTurnEnded: async () => {
      probed++;
      return true;
    },
  });
  await intake.event();
  assert.equal(probed, 0);
  assert.equal(saved.wake, 'uncertain');
});

test('the rollout tail proves only a completed turn that started after the queued message', () => {
  const since = uuidV7Millis(MSG);
  assert.equal(since, 1794618930000);
  assert.equal(lastRecordEndsTurnAfter(`{"type":"x"}\n${ended(1794618933)}\n`, since), true);
  assert.equal(lastRecordEndsTurnAfter(`${ended(1794618000)}\n`, since), false);
  assert.equal(
    lastRecordEndsTurnAfter(`${ended(1794618933)}\n{"type":"response_item"}\n`, since),
    false
  );
  assert.equal(
    lastRecordEndsTurnAfter('{"type":"event_msg","payload":{"type":"task_compl', since),
    false
  );
  assert.equal(uuidV7Millis(A), null);
});

test('the probe reads the native queue and rollout read-only and refuses a still-queued message', async () => {
  const home = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'native-turn-'));
  try {
    const rollout = join(home, 'rollout.jsonl');
    await writeFile(rollout, `${ended(1794618933)}\n`);
    const queue = new DatabaseSync(join(home, 'queue_1.sqlite'));
    queue.exec('CREATE TABLE queued_items (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL)');
    queue.close();
    const state = new DatabaseSync(join(home, 'state_5.sqlite'));
    state.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)');
    state.prepare('INSERT INTO threads VALUES (?, ?)').run(TARGET, rollout);
    state.close();
    const probe = createNativeTurnProbe({ codexHome: home });
    assert.equal(await probe(requested), true);
    const writer = new DatabaseSync(join(home, 'queue_1.sqlite'));
    writer.prepare('INSERT INTO queued_items VALUES (?, ?)').run(MSG, TARGET);
    writer.close();
    assert.equal(await probe(requested), false);
    assert.equal(
      await createNativeTurnProbe({ codexHome: join(home, 'missing') })(requested),
      false
    );
  } finally {
    await rm(home, { recursive: true });
  }
});

test('a turn refused for the usage limit is released only after the hold since it completed', () => {
  const since = 1794618930000;
  const refused = JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      started_at: 1794618940,
      completed_at: 1794618942,
      error: { message: 'You have hit your usage limit.', codex_error_info: 'usage_limit_exceeded' },
    },
  });
  const completed = 1794618942000;
  assert.equal(lastRecordEndsTurnAfter(refused, since, completed + 2_000), false);
  assert.equal(lastRecordEndsTurnAfter(refused, since, completed + USAGE_LIMIT_HOLD_MS - 1), false);
  assert.equal(lastRecordEndsTurnAfter(refused, since, completed + USAGE_LIMIT_HOLD_MS), true);
  const noCompletion = JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      started_at: 1794618940,
      error: { codex_error_info: 'usage_limit_exceeded' },
    },
  });
  assert.equal(lastRecordEndsTurnAfter(noCompletion, since, completed + 10 * USAGE_LIMIT_HOLD_MS), false);
  // Any other ending is released at once, as before.
  assert.equal(lastRecordEndsTurnAfter(ended(1794618940), since, completed), true);
});
