import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { V31ReplayState } from '../engine/HorseV31CertifiedPolicy.js';
import { buildGtoV31ReplayCorpus } from './GtoV31ReplayDigest.js';
import {
  buildGtoV31EvaluationScenariosV3,
  gtoV31V3WithReplayRecording,
} from './GtoV31EvaluationContractV3.js';
import {
  decodeGtoV31ReplayCorpus,
  encodeGtoV31ReplayCorpus,
  gtoV31ExecutionDigest,
  gtoV31RecheckMatchup,
} from './GtoV31Recheck.js';

const CHECKSUM = '7'.repeat(64);

function state(i: number): V31ReplayState {
  return {
    schemaVersion: 1,
    street: 'turn',
    player: { seat: 1, user_id: 'hero', cards: [] },
    opponents: [{ seat: 2, user_id: 'villain', cards: [] }],
    gs: { pot: 100 + i },
    vi: {},
    opts: { gtoV31DatasetChecksum: CHECKSUM },
    useMind: false,
    isRiver: false,
    isTournament: false,
    trustedTournament: undefined,
    pot: 100 + i,
    toCall: 0,
    currentBet: 0,
    rng: i + 1,
    opponentRead: null,
    decision: { action: 'check', thinkTime: 0 },
  } as unknown as V31ReplayState;
}

describe('V31 re-check: the stored corpus', () => {
  const corpus = buildGtoV31ReplayCorpus(
    Array.from({ length: 40 }, (_, i) => state(i)),
    CHECKSUM
  );

  it('round-trips byte-exactly through gzip and the anchor identity', () => {
    const encoded = encodeGtoV31ReplayCorpus(corpus);
    const gz = Buffer.from(encoded.base64, 'base64');
    expect(gz.subarray(0, 2).toString('hex')).toBe('1f8b');
    expect(encoded.sha256).toBe(createHash('sha256').update(gz).digest('hex'));
    expect(encoded.bytes).toBe(gz.length);
    const back = decodeGtoV31ReplayCorpus(encoded.base64, {
      sha256: encoded.sha256,
      checksum: corpus.checksum,
      datasetChecksum: CHECKSUM,
    });
    expect(back).toEqual(corpus);
  });

  it('refuses bytes, a corpus or a dataset other than the anchored ones', () => {
    const encoded = encodeGtoV31ReplayCorpus(corpus);
    const expected = {
      sha256: encoded.sha256,
      checksum: corpus.checksum,
      datasetChecksum: CHECKSUM,
    };
    expect(() =>
      decodeGtoV31ReplayCorpus(encoded.base64, { ...expected, sha256: '0'.repeat(64) })
    ).toThrow(/bytes do not match/);
    expect(() =>
      decodeGtoV31ReplayCorpus(encoded.base64, { ...expected, checksum: 'f'.repeat(64) })
    ).toThrow(/not the anchored corpus/);
    expect(() =>
      decodeGtoV31ReplayCorpus(encoded.base64, { ...expected, datasetChecksum: '8'.repeat(64) })
    ).toThrow(/not the anchored corpus/);
    // A re-gzipped, edited corpus with a matching sha is still refused by its own checksum.
    const edited = structuredClone(corpus);
    edited.states[0].pot += 1;
    const gz = gzipSync(Buffer.from(JSON.stringify(edited)));
    expect(() =>
      decodeGtoV31ReplayCorpus(gz.toString('base64'), {
        ...expected,
        sha256: createHash('sha256').update(gz).digest('hex'),
      })
    ).toThrow(/refused/);
  });

  it('refuses to store a corpus that does not verify', () => {
    expect(() => encodeGtoV31ReplayCorpus({ ...corpus, checksum: '0'.repeat(64) })).toThrow(
      /refused before storing/
    );
  });
});

describe('V31 re-check: naming and recording', () => {
  it('names a re-check result for its certification table and the re-checked engine', () => {
    expect(gtoV31RecheckMatchup('gto_v31_league_cash_abc', 'd4'.repeat(20))).toBe(
      `gto_v31_league_cash_abc_recheck_${'d4'.repeat(20)}`
    );
    expect(() => gtoV31RecheckMatchup('x', 'abc')).toThrow(/full serving commit/);
  });

  it('taps only the candidate arm, on both runs of a league table, and only when asked', () => {
    const [scenario] = buildGtoV31EvaluationScenariosV3('cash', 'league', CHECKSUM, [
      'cash_ev_2max_80bb',
    ]);
    expect(gtoV31V3WithReplayRecording(scenario, CHECKSUM, undefined, undefined)).toBe(scenario);
    const hook = () => {};
    const tapped = gtoV31V3WithReplayRecording(scenario, CHECKSUM, hook, 2_000);
    expect(tapped.pairs).toBe(2_000);
    expect(scenario.pairs).toBe(50_000);
    for (const m of [tapped.matchup, tapped.memoryOff!]) {
      const [candidate, baseline] =
        m.a.gtoV31DatasetChecksum === CHECKSUM ? [m.a, m.b] : [m.b, m.a];
      expect(candidate.onV31ReplayState).toBe(hook);
      expect(baseline.onV31ReplayState).toBeUndefined();
    }
    expect(tapped.memoryOff!.memoryLearning).toBe('off');
    expect(() => gtoV31V3WithReplayRecording(scenario, CHECKSUM, hook, 0)).toThrow(/pairs_invalid/);
  });
});

describe('V31 re-check: the execution digest', () => {
  it('is exactly what the CI fingerprint tool computes for the commit', async () => {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const cli = JSON.parse(
      execFileSync(process.execPath, ['scripts/ci/v31-execution-fingerprint.mjs', '.', head], {
        cwd: root,
        encoding: 'utf8',
      })
    ) as Record<string, { digest: string | null }>;
    expect(await gtoV31ExecutionDigest(head)).toBe(cli[head].digest);
    await expect(gtoV31ExecutionDigest('abc')).rejects.toThrow(/full commit/);
  }, 60_000);
});
