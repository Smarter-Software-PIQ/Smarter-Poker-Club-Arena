import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicationMode } from '../../scripts/ci/club-create-publication-mode.mjs';
import { readPublisherArtifactSha } from '../../scripts/ci/production-e2e-provenance.mjs';
const trigger = 'a'.repeat(40),
  runtime = 'b'.repeat(40);
const artifact = (name) => ({
  name,
  id: 1,
  expired: false,
  workflow_run: {
    id: 123,
    head_sha: trigger,
    head_branch: 'main',
    repository_id: 456,
    head_repository_id: 456,
  },
});
const raw = (rows) => JSON.stringify({ total_count: rows.length, artifacts: rows });
const mode = (rows) => publicationMode(raw(rows), '123', trigger, '456');
test('actual retained publisher has zero dist: old resolver refuses, same-run retained route admits', () => {
  const rows = [artifact('club-arena-retained-runtime')];
  assert.throws(() => readPublisherArtifactSha(raw(rows), '123', trigger, '456'), /received 0/);
  assert.equal(mode(rows), 'retained');
});
test('ordinary exact dist remains required and supported', () =>
  assert.equal(mode([artifact('club-arena-dist-' + runtime)]), 'published'));
test('missing, duplicate and mixed artifact provenance refuses', () => {
  for (const rows of [
    [],
    [artifact('club-arena-retained-runtime'), artifact('club-arena-retained-runtime')],
    [artifact('club-arena-retained-runtime'), artifact('club-arena-dist-' + runtime)],
  ])
    assert.throws(() => mode(rows));
});
test('foreign run, branch, trigger and expired retention refuse', () => {
  for (const change of [
    (a) => (a.workflow_run.id = 789),
    (a) => (a.workflow_run.head_branch = 'foreign'),
    (a) => (a.workflow_run.head_sha = runtime),
    (a) => (a.expired = true),
  ]) {
    const a = artifact('club-arena-retained-runtime');
    change(a);
    assert.throws(() => mode([a]));
  }
});
test('connected Create uses same-run receipt, current verification source and exact runtime bracket before fixtures', () => {
  const text = readFileSync(
    new URL('../../.github/workflows/club-create-certification.yml', import.meta.url),
    'utf8'
  );
  for (const s of [
    'club-create-publication-mode.mjs',
    'client-runtime-retention.mjs receipt-artifact',
    'client-runtime-retention.mjs receive',
    'steps.published.outputs.verification_sha || steps.published.outputs.sha',
    "expected='${{ steps.published.outputs.sha }}'",
    'client-runtime-retention.mjs harness',
  ])
    assert.ok(text.includes(s), s);
  assert.ok(
    text.indexOf('client-runtime-retention.mjs harness') <
      text.indexOf('Verify Opening Grant Capacity Before Creating Fixtures')
  );
  assert.ok(text.includes('cancel-in-progress: false'));
  assert.ok(text.includes('timeout-minutes: 60'));
});

// 2026-11-07: a publisher run that published nothing stands Create Club down.
// Job names and conclusions are publisher run 42346558084 (113c79e70a), which
// turned this certificate red with "Exactly one published bundle or one
// retained runtime receipt required."
import { nothingPublished } from '../../scripts/ci/club-create-publication-mode.mjs';
const job = (name, conclusion, steps = conclusion === 'skipped' ? 0 : 5) => ({
  name,
  status: 'completed',
  conclusion,
  steps: Array.from({ length: steps }, (_, i) => ({ number: i + 1 })),
});
const noPublishRun = () => [
  job('publish-needed', 'success', 9),
  job('client-publication / Validate The Selected Client Publication Source', 'success'),
  job('client-publication / admit', 'success', 8),
  job('build-record-gateway', 'skipped'),
  job('production', 'skipped'),
  job('client-publication / build-and-store', 'skipped'),
  job('client-publication / client-tests', 'skipped'),
  job('client-publication / production', 'skipped'),
];
const jobsRaw = (rows) => JSON.stringify({ total_count: rows.length, jobs: rows });
test('a publisher that published nothing stands the certificate down', () =>
  assert.equal(nothingPublished(jobsRaw(noPublishRun())), true));
test('any built bundle, started production, failure, unknown job or partial page still certifies', () => {
  const variants = [
    (r) => (r[5] = job('client-publication / build-and-store', 'success')),
    (r) => (r[7] = job('client-publication / production', 'success')),
    (r) => (r[7] = job('client-publication / production', 'skipped', 1)),
    (r) => (r[2] = job('client-publication / admit', 'failure')),
    (r) => r.push(job('some-new-writer', 'success')),
    (r) => r.push(job('publish-needed', 'success', 9)),
    (r) => (r[0] = { ...r[0], status: 'in_progress' }),
  ];
  for (const change of variants) {
    const rows = noPublishRun();
    change(rows);
    assert.equal(nothingPublished(jobsRaw(rows)), false);
  }
  assert.equal(nothingPublished(JSON.stringify({ total_count: 9, jobs: noPublishRun() })), false);
  assert.equal(nothingPublished(jobsRaw([])), false);
});
test('the workflow reads the exact source run jobs and gates certify on them', () => {
  const text = readFileSync(
    new URL('../../.github/workflows/club-create-certification.yml', import.meta.url),
    'utf8'
  );
  assert.ok(text.includes('club-create-publication-mode.mjs --nothing-published'));
  assert.ok(text.includes("needs.publication.outputs.mode == 'publication'"));
  assert.ok(text.includes("github.event_name == 'repository_dispatch'"));
});
