import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// PR #7780 (2026-10-23): a horse engine change fired a new telemetry key and the
// local pre-push stayed green, because `vitest related` only finds tests that
// IMPORT a changed file and the Horse data ledger law reads server source as
// text. Hosted CI caught it 35 minutes later. The hook now selects such laws by
// what the changed file contains. This runs the hook's real server gate.
const ROOT = join(__dirname, '..', '..');
const hook = readFileSync(join(ROOT, '.husky/pre-push'), 'utf8');
const marker = '\nSERVER_VITEST="$CA_TREE_TOP/server/node_modules/.bin/vitest"';
const serverGate = hook.slice(hook.indexOf(marker));

function gate(
  files: Record<string, string>,
  runnerExit = 0,
  failingLaw = 'HorseDataLedger',
  changed: string[] = Object.keys(files)
) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ca-source-contracts-')));
  try {
    writeFileSync(join(dir, 'server-package'), '');
    mkdirSync(join(dir, 'server'), { recursive: true });
    writeFileSync(join(dir, 'server/package.json'), '{}');
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), body);
    }
    const runner = join(dir, 'server/node_modules/.bin/vitest');
    mkdirSync(dirname(runner), { recursive: true });
    writeFileSync(
      runner,
      '#!/bin/bash\nprintf "%s\\n" "$*" >> "$TRACE"\n' +
        'case "$*" in run*"$FAILING_LAW"*) exit "$CONTRACT_EXIT";; esac\nexit 0\n',
      { mode: 0o755 }
    );
    const trace = join(dir, 'trace');
    const result = spawnSync('bash', ['-c', 'set -e\nFAIL=0\n' + serverGate], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        CA_TREE_TOP: dir,
        FILES: changed.join('\n'),
        SERVER_DEPENDENCY_MODE: 'local',
        TRACE: trace,
        CONTRACT_EXIT: String(runnerExit),
        FAILING_LAW: failingLaw,
      },
    });
    let calls = '';
    try {
      calls = readFileSync(trace, 'utf8');
    } catch {
      calls = '';
    }
    return { status: result.status, output: result.stdout + result.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('server source-contract laws are selected before a push', () => {
  it('runs the Horse data ledger law for a changed file that fires horse telemetry', () => {
    const r = gate({ 'server/src/engine/Turns.ts': "noteFire('a_new_key');\n" });
    expect(r.status).toBe(0);
    expect(r.calls).toContain('run src/engine/HorseDataLedger.test.ts');
    expect(r.calls).toContain('related --run src/engine/Turns.ts');
  });

  it('blocks the push when that law fails', () => {
    const r = gate({ 'server/src/engine/Turns.ts': "noteFire('a_new_key');\n" }, 1);
    expect(r.status).toBe(1);
    expect(r.output).toContain('BLOCKED: a source-contract law over your server change failed.');
  });

  it('adds nothing for a server file that fires no telemetry', () => {
    const r = gate({ 'server/src/engine/Rules.ts': 'export const x = 1;\n' });
    expect(r.status).toBe(0);
    expect(r.calls).not.toContain('HorseDataLedger');
  });

  it('runs a changed source contract only once and excludes only that exact file from related tests', () => {
    const r = gate({
      'server/src/engine/HorseDataLedger.test.ts': '// changed contract\n',
      'server/src/engine/Turns.ts': "noteFire('a_new_key');\n",
    });
    expect(r.status).toBe(0);
    const calls = r.calls.trim().split('\n');
    expect(calls.filter((line) => line === 'run src/engine/HorseDataLedger.test.ts')).toHaveLength(
      1
    );
    expect(calls).toContain(
      'related --run src/engine/Turns.ts --exclude src/engine/HorseDataLedger.test.ts --passWithNoTests'
    );
  });

  // PR #9817 (2026-11-07): two new engine files imported into HorseLogic pushed
  // green and failed hosted CI on the reference decision sources law.
  const DIGEST_LAWS = [
    'src/engine/HorseReferenceDecisionSources.test.ts',
    'src/engine/aHashedPolicySourceShipsInTheEngineImage.law.test.ts',
    'src/engine/HorsePhase10Authority.test.ts',
    'src/engine/HorsePhase11PolicyDigest.test.ts',
    'src/engine/HorsePhase12PolicyDigest.test.ts',
    'src/engine/HorsePhase13PolicyDigest.test.ts',
  ];
  const digestTree = (extra: Record<string, string>) => ({
    ...Object.fromEntries(DIGEST_LAWS.map((law) => [`server/${law}`, '// law\n'])),
    'server/src/engine/HorseLogic.ts':
      "import { decideV31Certified } from './HorseV31CertifiedPolicy.js';\n" +
      "import {\n  workerThing,\n} from './horseDecision/workerThing.js';\n",
    'server/src/engine/HorseReferenceDecisionSources.ts':
      "export const R = { 'src/engine/GtoPostflopV31.ts': 'the V31 solver consult' };\n",
    ...extra,
  });
  const digestRun = `run ${DIGEST_LAWS.join(' ')}`;

  it('runs the decision-digest laws for a change to HorseLogic itself', () => {
    const r = gate(
      digestTree({ 'server/src/engine/HorseLogic.ts': "import { a } from './NewFile.js';\n" }),
      0,
      'HorseDataLedger',
      ['server/src/engine/HorseLogic.ts']
    );
    expect(r.status).toBe(0);
    expect(r.calls.trim().split('\n')).toContain(digestRun);
  });

  it('runs them for a changed file HorseLogic imports, including a nested one', () => {
    for (const changed of [
      'server/src/engine/HorseV31CertifiedPolicy.ts',
      'server/src/engine/horseDecision/workerThing.ts',
    ]) {
      const r = gate(digestTree({ [changed]: 'export const x = 1;\n' }), 0, 'HorseDataLedger', [
        changed,
      ]);
      expect(r.status, changed).toBe(0);
      expect(r.calls.trim().split('\n'), changed).toContain(digestRun);
    }
  });

  it('runs them for a listed reference decision source and for the list itself', () => {
    for (const changed of [
      'server/src/engine/GtoPostflopV31.ts',
      'server/src/engine/HorseReferenceDecisionSources.ts',
    ]) {
      const r = gate(digestTree({ [changed]: "export const x = 'v';\n" }), 0, 'HorseDataLedger', [
        changed,
      ]);
      expect(r.calls.trim().split('\n'), changed).toContain(digestRun);
    }
  });

  it('does not run them for an engine file outside the decision closure', () => {
    const r = gate(
      digestTree({ 'server/src/engine/Rules.ts': 'export const x = 1;\n' }),
      0,
      'HorseDataLedger',
      ['server/src/engine/Rules.ts']
    );
    expect(r.status).toBe(0);
    expect(r.calls).not.toContain('HorseReferenceDecisionSources');
  });

  it('a failing digest law blocks the push', () => {
    const tree = digestTree({
      'server/src/engine/HorseV31CertifiedPolicy.ts': 'export const x = 1;\n',
    });
    const r = gate(tree, 1, 'HorseReferenceDecisionSources', [
      'server/src/engine/HorseV31CertifiedPolicy.ts',
    ]);
    expect(r.status).toBe(1);
    expect(r.output).toContain('BLOCKED: a source-contract law over your server change failed.');
  });

  it('every digest law the hook names exists in the server', () => {
    for (const law of DIGEST_LAWS) expect(hook).toContain(law);
    for (const law of DIGEST_LAWS)
      expect(() => readFileSync(join(ROOT, 'server', law))).not.toThrow();
  });

  it('the ledger law still reads every fired telemetry key from source', () => {
    const law = readFileSync(join(ROOT, 'server/src/engine/HorseDataLedger.test.ts'), 'utf8');
    expect(law).toMatch(/noteFire/);
  });
});
