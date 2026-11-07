#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublisherArtifactSha } from './production-e2e-provenance.mjs';
import { receiptArtifactId } from './client-runtime-retention.mjs';
export function publicationMode(raw, run, trigger, repository) {
  const payload = JSON.parse(String(raw));
  if (!Array.isArray(payload.artifacts) || payload.total_count !== payload.artifacts.length)
    throw new Error('Complete exact publisher artifact metadata required.');
  const bundles = payload.artifacts.filter(
    (a) => typeof a.name === 'string' && a.name.startsWith('club-arena-dist-')
  );
  const retained = payload.artifacts.filter((a) => a.name === 'club-arena-retained-runtime');
  if (bundles.length === 1 && retained.length === 0) {
    readPublisherArtifactSha(raw, run, trigger, repository);
    return 'published';
  }
  if (retained.length === 1 && bundles.length === 0) {
    receiptArtifactId(payload, run, trigger, repository);
    return 'retained';
  }
  throw new Error('Exactly one published bundle or one retained runtime receipt required.');
}
// NOTHING WAS PUBLISHED, SO THERE IS NOTHING TO CERTIFY (2026-11-07).
// A successful publisher that decided no client publish was needed builds no
// bundle and writes no retained receipt, and publicationMode() rightly refuses
// it. Certifying Create Club against such a run turned this workflow red for
// every engine-only or documentation-only merge (27 of 30 runs on
// 2026-11-06/07, none tracked). post-deploy-e2e.yml already treats the same
// provider shape as a non-verdict (#9798); this is that test, on the jobs of
// the exact source run. Only this one shape stands down: any built bundle,
// unknown job, production caller that ran a step, or failure still certifies
// or refuses.
export function nothingPublished(raw) {
  const payload = JSON.parse(String(raw));
  const jobs = payload.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0 || payload.total_count !== jobs.length)
    return false;
  if (new Set(jobs.map((j) => j.name)).size !== jobs.length) return false;
  const productionNeverStarted = (j) =>
    ['production', 'client-publication / production'].includes(j.name) &&
    ['cancelled', 'skipped'].includes(j.conclusion) &&
    (j.steps ?? []).length === 0;
  const admitted = [
    'publish-needed',
    'client-publication / admit',
    'client-publication / Validate The Selected Client Publication Source',
  ];
  const skipped = [
    'build-record-gateway',
    'client-publication / build-and-store',
    'client-publication / client-tests',
  ];
  return (
    jobs.some((j) => j.name === 'publish-needed' && j.conclusion === 'success') &&
    jobs.some((j) => j.name === 'client-publication / build-and-store' && j.conclusion === 'skipped') &&
    jobs.every(
      (j) =>
        j.status === 'completed' &&
        ((admitted.includes(j.name) && j.conclusion === 'success') ||
          (skipped.includes(j.name) && j.conclusion === 'skipped' && (j.steps ?? []).length === 0) ||
          productionNeverStarted(j))
    )
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--nothing-published') {
      console.log(nothingPublished(readFileSync(0, 'utf8')) ? 'none' : 'publication');
      process.exit(0);
    }
    console.log(publicationMode(readFileSync(0, 'utf8'), ...process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
