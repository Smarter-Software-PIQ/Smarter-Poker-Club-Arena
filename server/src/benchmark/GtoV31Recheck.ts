/**
 * V31 STRICT RE-CHECK: the evaluator's half (2026-11-06, Phase 3 of the R8 plan).
 *
 * At certification the evaluator records an execution anchor for the epoch:
 * the execution digest of the certifying engine (scripts/ci/
 * v31-execution-fingerprint.mjs) and a replay corpus of its certified
 * decisions with the corpus's replay digest (GtoV31ReplayDigest.ts). The
 * corpus comes from a deterministic recording pass over every certification
 * table of every family, both kinds, at GTO_V31_ANCHOR_RECORDING_PAIRS pairs
 * per table with the certification seeds.
 *
 * On a later engine (`--recheck`) the evaluator proves both digests are
 * identical before a single hand is dealt, then re-runs every certification
 * table with the certification seeds and records each result against the
 * re-check round. The database decides: all wins/ties pass the round; one
 * loss retires the playbook for good.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { V31ReplayState } from '../engine/HorseV31CertifiedPolicy.js';
import {
  buildGtoV31ReplayCorpus,
  verifyGtoV31ReplayCorpus,
  type GtoV31ReplayCorpus,
} from './GtoV31ReplayDigest.js';
import { runGtoV31EvaluationFamilyV3 } from './GtoV31EvaluationContractV3.js';
import type { GtoV31EvaluationFamily, GtoV31EvaluationKind } from './GtoV31CandidateEvaluation.js';

/** One fifth of a certification table: enough states for the corpus, a fraction of the cost. */
export const GTO_V31_ANCHOR_RECORDING_PAIRS = 2_000;
const KINDS: readonly GtoV31EvaluationKind[] = ['paired_replay', 'league'];
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

export interface EncodedReplayCorpus {
  base64: string;
  sha256: string;
  bytes: number;
}

/** gzip of the corpus JSON; the database addresses it by the SHA-256 of these bytes. */
export function encodeGtoV31ReplayCorpus(corpus: GtoV31ReplayCorpus): EncodedReplayCorpus {
  const problem = verifyGtoV31ReplayCorpus(corpus);
  if (problem) throw new Error(`replay corpus refused before storing: ${problem}`);
  const gz = gzipSync(Buffer.from(JSON.stringify(corpus), 'utf8'), { level: 9 });
  if (gz.length > 8 * 1024 * 1024) {
    throw new Error(`replay corpus is ${gz.length} bytes gzipped; the stored limit is 8 MiB`);
  }
  return {
    base64: gz.toString('base64'),
    sha256: createHash('sha256').update(gz).digest('hex'),
    bytes: gz.length,
  };
}

/** The stored corpus, proven to be exactly the anchored one. */
export function decodeGtoV31ReplayCorpus(
  base64: string,
  expected: { sha256: string; checksum: string; datasetChecksum: string }
): GtoV31ReplayCorpus {
  const gz = Buffer.from(String(base64).replace(/\s+/g, ''), 'base64');
  if (createHash('sha256').update(gz).digest('hex') !== expected.sha256) {
    throw new Error('the stored replay corpus bytes do not match the anchor');
  }
  const corpus = JSON.parse(gunzipSync(gz).toString('utf8')) as GtoV31ReplayCorpus;
  const problem = verifyGtoV31ReplayCorpus(corpus);
  if (problem) throw new Error(`the stored replay corpus is refused: ${problem}`);
  if (
    corpus.checksum !== expected.checksum ||
    corpus.datasetChecksum !== expected.datasetChecksum
  ) {
    throw new Error('the stored replay corpus is not the anchored corpus of this dataset');
  }
  return corpus;
}

/** A re-check result's name: the certification result's name plus the re-checked engine. */
export function gtoV31RecheckMatchup(certificationMatchup: string, servingCommit: string): string {
  if (!HEX40.test(servingCommit)) throw new Error('a re-check names the full serving commit');
  return `${certificationMatchup}_recheck_${servingCommit}`;
}

/**
 * The recording pass: every certification table of every family, both kinds,
 * with the certification seeds and GTO_V31_ANCHOR_RECORDING_PAIRS pairs each.
 */
export async function recordGtoV31ReplayCorpus(args: {
  datasetChecksum: string;
  families: ReadonlyArray<{ family: GtoV31EvaluationFamily; tables: readonly string[] }>;
  seedFor: (kind: GtoV31EvaluationKind, family: GtoV31EvaluationFamily) => number;
  pairsPerTable?: number;
  shouldContinue?: () => boolean;
}): Promise<GtoV31ReplayCorpus> {
  if (!HEX64.test(args.datasetChecksum))
    throw new Error('replay recording needs the dataset checksum');
  if (args.families.length === 0) throw new Error('replay recording needs at least one family');
  const captured: V31ReplayState[] = [];
  for (const kind of KINDS) {
    for (const { family, tables } of args.families) {
      await runGtoV31EvaluationFamilyV3({
        family,
        kind,
        datasetChecksum: args.datasetChecksum,
        tables,
        runSeed: args.seedFor(kind, family),
        shouldContinue: args.shouldContinue,
        pairsPerTable: args.pairsPerTable ?? GTO_V31_ANCHOR_RECORDING_PAIRS,
        onReplayState: (state) => captured.push(state),
      });
    }
  }
  return buildGtoV31ReplayCorpus(captured, args.datasetChecksum);
}

/** The execution digest of a commit, by the CI fingerprint tool itself (one definition). */
export async function gtoV31ExecutionDigest(commit: string, cwd = process.cwd()): Promise<string> {
  if (!HEX40.test(commit)) throw new Error('an execution digest names a full commit');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const tool = (await import(
    pathToFileURL(join(root, 'scripts/ci/v31-execution-fingerprint.mjs')).href
  )) as {
    executionClosure: (repo: string, sha: string) => unknown;
    executionDigest: (closure: unknown) => string;
  };
  const digest = tool.executionDigest(tool.executionClosure(root, commit));
  if (!HEX64.test(digest)) throw new Error('the execution fingerprint tool returned no digest');
  return digest;
}
