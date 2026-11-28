/**
 * LAW: CONTROL-PLANE FAULT-INJECTION, CORRUPT ARTIFACT, DST BOUNDARY & BLAST-RADIUS PARITY
 *
 * Exercises the cutover control-plane scripts under adverse conditions:
 *   - scripts/release/step-down-past-held-migration.py
 *   - scripts/release/next-candidate-after-cycle.py
 *   - scripts/ci/select-daily-engine.py
 *
 * Proves:
 *   1. HTTP 403 rate-limit, 502, 503, empty stdout, truncated JSON, and malformed
 *      schemas produce fail-safe 'unknown' / non-zero refusal (CLAUDE.md 10.86) --
 *      NEVER silently skipping, approving, or fabricating a passing verdict.
 *   2. Corrupt, truncated, expired, oversized, or tampered Backup certificate
 *      artifacts are rejected fail-closed by select-daily-engine.py.
 *   3. America/Chicago DST spring-forward (2026-03-08) and fall-back (2026-11-01,
 *      including the repeated 01:00 AM hour resolving deterministically to fold=0 CDT)
 *      agree across select-daily-engine.py and next-candidate-after-cycle.py.
 *   4. All Wave A-4 telemetry, host-posture, draft-revert, wire-protocol, and
 *      chaos-test files stay strictly outside CONTROL_INPUTS (zero certificate
 *      blast radius).
 */
import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  controlLists,
  isReleaseControlPath,
  parseControlLists,
} from '../scripts/ci/release-control-paths.mjs';

const ROOT = resolve(__dirname, '..');
const TMP_BASE = join(ROOT, 'node_modules', '.tmp');
const STEP_DOWN = join(ROOT, 'scripts', 'release', 'step-down-past-held-migration.py');
const NEXT_CAND = join(ROOT, 'scripts', 'release', 'next-candidate-after-cycle.py');
const SELECT_DAILY = join(ROOT, 'scripts', 'ci', 'select-daily-engine.py');
const PREQUAL_PY = join(ROOT, 'scripts', 'ci', 'read-engine-prequalification.py');

const SHA_A = 'a'.repeat(40);

const WAVE_A4_FILES = [
  'scripts/release/post-cutover-baseline-diff.py',
  'tests/operations/post-cutover-baseline-diff.test.py',
  'scripts/release/check-host-posture.sh',
  'tests/operations/check-host-posture.test.ts',
  'scripts/release/draft-revert-bad-commit.py',
  'tests/operations/draft-revert-bad-commit.test.py',
  'scripts/ci/check-wire-protocol-compat.mjs',
  'tests/unit/wireProtocolCompat.test.ts',
  'tests/cutover-control-plane-chaos.law.test.ts',
  'docs/laws.d/tests-cutover-control-plane-chaos.md',
];

function makeGhStubDir(rc: number, stdoutText: string, stderrText = ''): string {
  mkdirSync(TMP_BASE, { recursive: true });
  const dir = mkdtempSync(join(TMP_BASE, 'chaos-gh-'));
  const ghPath = join(dir, 'gh');
  const outPath = join(dir, 'stdout.txt');
  const errPath = join(dir, 'stderr.txt');
  writeFileSync(outPath, stdoutText, 'utf8');
  writeFileSync(errPath, stderrText, 'utf8');
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash\ncat "${outPath}"\ncat "${errPath}" >&2\nexit ${rc}\n`,
    'utf8'
  );
  chmodSync(ghPath, 0o755);
  return dir;
}

describe('control-plane fault-injection & DST boundary chaos laws', () => {
  describe('1. GitHub API & /health fault injection (fail-safe unknown, never silent pass)', () => {
    const FAULT_MODES: Array<{ name: string; rc: number; stdout: string; stderr: string }> = [
      {
        name: 'HTTP 403 rate limit',
        rc: 1,
        stdout: '{"message":"API rate limit exceeded"}',
        stderr: 'gh: API rate limit exceeded (HTTP 403)',
      },
      {
        name: 'HTTP 502 Bad Gateway',
        rc: 1,
        stdout: '<html><body>502 Bad Gateway</body></html>',
        stderr: 'gh: 502 Bad Gateway (HTTP 502)',
      },
      {
        name: 'HTTP 503 Service Unavailable',
        rc: 1,
        stdout: '{"message":"Service Unavailable"}',
        stderr: 'gh: Service Unavailable (HTTP 503)',
      },
      {
        name: 'empty stdout with exit 0',
        rc: 0,
        stdout: '',
        stderr: '',
      },
      {
        name: 'truncated JSON with exit 0',
        rc: 0,
        stdout: '{"workflow_runs":[{"id":12345,"head_sha":"' + SHA_A,
        stderr: '',
      },
      {
        name: 'malformed schema (non-list workflow_runs)',
        rc: 0,
        stdout: '{"workflow_runs":"corrupt"}',
        stderr: '',
      },
    ];

    it('step-down-past-held-migration.py prequal_state and backup_status_state return unknown under every API fault', () => {
      for (const fault of FAULT_MODES) {
        const stubDir = makeGhStubDir(fault.rc, fault.stdout, fault.stderr);
        try {
          const env = {
            ...process.env,
            PATH: `${stubDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          };
          const cli = spawnSync(
            'python3',
            [
              '-B',
              STEP_DOWN,
              '--check-prequal-only',
              '--repo',
              'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
              '--sha',
              SHA_A,
            ],
            { encoding: 'utf8', env }
          );
          expect(cli.status, fault.name).toBe(0);
          expect(cli.stdout.trim(), fault.name).toBe('prequal=unknown');

          const pyBackup = spawnSync(
            'python3',
            [
              '-B',
              '-c',
              `import importlib.util, sys
spec = importlib.util.spec_from_file_location('sd', ${JSON.stringify(STEP_DOWN)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod.backup_status_state('Smarter-Software-PIQ/Smarter-Poker-Club-Arena', ${JSON.stringify(SHA_A)}))`,
            ],
            { encoding: 'utf8', env }
          );
          expect(pyBackup.status, fault.name).toBe(0);
          expect(pyBackup.stdout.trim(), fault.name).toBe('unknown');
        } finally {
          rmSync(stubDir, { recursive: true, force: true });
        }
      }
    });

    it('step-down-past-held-migration.py serving_release fails closed on HTTP 403/502/503/empty/truncated /health', () => {
      const py = `
import http.server, importlib.util, json, threading

spec = importlib.util.spec_from_file_location('sd', ${JSON.stringify(STEP_DOWN)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

MODES = [
    (403, '{"error":"forbidden"}'),
    (502, '<html>502</html>'),
    (503, '{"error":"unavailable"}'),
    (200, ''),
    (200, '{"releaseSha":"' + ${JSON.stringify(SHA_A)}),
    (200, '{"releaseSha":"not-a-sha"}'),
]
state = {'idx': 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        code, body = MODES[state['idx']]
        data = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, fmt, *args):
        pass

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
port = srv.server_address[1]
t = threading.Thread(target=srv.serve_forever, daemon=True)
t.start()
try:
    results = []
    for i in range(len(MODES)):
        state['idx'] = i
        results.append(mod.serving_release(f'http://127.0.0.1:{port}/health'))
    print(json.dumps(results))
finally:
    srv.shutdown()
    srv.server_close()
`;
      const proc = spawnSync('python3', ['-B', '-c', py], { encoding: 'utf8' });
      expect(proc.status, proc.stderr).toBe(0);
      const results: string[] = JSON.parse(proc.stdout);
      expect(results).toEqual(['', '', '', '', '', '']);
    });

    it('select-daily-engine.py fails closed (raises, never selects) on API 403/502/503/empty/truncated responses', () => {
      for (const fault of FAULT_MODES) {
        const stubDir = makeGhStubDir(fault.rc, fault.stdout, fault.stderr);
        try {
          const env = {
            ...process.env,
            PATH: `${stubDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          };
          const proc = spawnSync(
            'python3',
            [
              '-B',
              '-c',
              `import importlib.util
spec = importlib.util.spec_from_file_location('sel', ${JSON.stringify(SELECT_DAILY)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
try:
    list(mod.statuses('Smarter-Software-PIQ/Smarter-Poker-Club-Arena', [${JSON.stringify(SHA_A)}]))
    print('UNEXPECTED_SUCCESS')
except Exception as exc:
    print('FAILED_CLOSED:' + type(exc).__name__)`,
            ],
            { encoding: 'utf8', env }
          );
          expect(proc.status, fault.name).toBe(0);
          expect(proc.stdout.trim(), fault.name).toMatch(/^FAILED_CLOSED:/);
        } finally {
          rmSync(stubDir, { recursive: true, force: true });
        }
      }
    });

    it('next-candidate-after-cycle.py decide refuses ambiguous dispatch when live /health is unreadable after selected=true', () => {
      for (const badLive of ['unknown', '', 'not-a-sha']) {
        const proc = spawnSync(
          'python3',
          [
            '-B',
            NEXT_CAND,
            'decide',
            '--selected',
            'true',
            '--selection-serving',
            SHA_A,
            '--live-serving',
            badLive,
          ],
          { encoding: 'utf8' }
        );
        expect(proc.status).toBe(0);
        expect(proc.stdout).toContain('dispatch=false');
        expect(proc.stdout).toContain('could not tell');
      }
    });
  });

  describe('2. Corrupt and expired Backup certificate artifacts in select-daily-engine.py', () => {
    it('rejects expired, corrupt-zip, malformed-JSON, oversized, and tampered certificates while accepting a valid bundle', () => {
      const harness = `
import importlib.util, io, json, zipfile

spec = importlib.util.spec_from_file_location('sel', ${JSON.stringify(SELECT_DAILY)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
SHA = ${JSON.stringify(SHA_A)}
LIMIT = 2000000000
STATUS = {
    'state': 'SUCCESS',
    'createdAt': '2026-11-28T03:00:00Z',
    'targetUrl': f'https://github.com/{REPO}/actions/runs/555',
}
GOOD_RUN = {
    'id': 555,
    'run_attempt': 1,
    'path': '.github/workflows/backup-engine.yml',
    'head_branch': 'main',
    'head_sha': SHA,
    'event': 'push',
    'conclusion': 'success',
    'updated_at': '2026-11-28T03:05:00Z',
}

def make_zip(cert_obj, compat_obj):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('certificate.json', json.dumps(cert_obj) if isinstance(cert_obj, dict) else cert_obj)
        zf.writestr('compatibility.json', json.dumps(compat_obj) if isinstance(compat_obj, dict) else compat_obj)
    return buf.getvalue()

GOOD_CERT = {
    'sha': SHA,
    'verdict': 'pass',
    'reasons': [],
    'fatalLogLines': 0,
    'soakSeconds': 1860,
    'certifiedAt': '2026-11-28T03:04:00Z',
    'database': {
        'restoreValidated': True,
        'restoreErrors': 0,
        'restoredAt': '2026-11-28T02:30:00Z',
        'dumpSha256': '1' * 64,
        'ownersSha256': '2' * 64,
    },
    'seed': {
        'tablesFailed': 0,
        'seededAt': '2026-11-28T02:35:00Z',
    },
}
GOOD_COMPAT = {'controlSha': SHA, 'targetSha': SHA}
ART_NAME = f'backup-certificate-{SHA}-1'

results = {}

# Case A: Expired artifact -> returns None + refusal reason
mod.api = lambda p: GOOD_RUN if p.endswith('/runs/555') else {'artifacts': [{'id': 9, 'name': ART_NAME, 'expired': True, 'size_in_bytes': 1024}]}
refused = []
res_expired = mod.backup(REPO, SHA, LIMIT, STATUS, refused)
results['expired'] = {'returnedNone': res_expired is None, 'refused': refused}

# Case B: Corrupt zip bytes -> raises BadZipFile
mod.api = lambda p: GOOD_RUN if p.endswith('/runs/555') else {'artifacts': [{'id': 9, 'name': ART_NAME, 'expired': False, 'size_in_bytes': 1024}]}
mod.command = lambda *a: b'NOT_A_VALID_ZIP_HEADER'
try:
    mod.backup(REPO, SHA, LIMIT, STATUS)
    results['corruptZip'] = 'UNEXPECTED_PASS'
except Exception as exc:
    results['corruptZip'] = type(exc).__name__

# Case C: Malformed JSON inside certificate.json -> raises JSONDecodeError
mod.command = lambda *a: make_zip('{"sha": "broken', GOOD_COMPAT)
try:
    mod.backup(REPO, SHA, LIMIT, STATUS)
    results['corruptJson'] = 'UNEXPECTED_PASS'
except Exception as exc:
    results['corruptJson'] = type(exc).__name__

# Case D: Oversized artifact -> raises ValueError
mod.api = lambda p: GOOD_RUN if p.endswith('/runs/555') else {'artifacts': [{'id': 9, 'name': ART_NAME, 'expired': False, 'size_in_bytes': mod.CONTENT_LIMIT + 1}]}
try:
    mod.backup(REPO, SHA, LIMIT, STATUS)
    results['oversized'] = 'UNEXPECTED_PASS'
except Exception as exc:
    results['oversized'] = f'{type(exc).__name__}:{exc}'

# Case E: Tampered certificate (soakSeconds < 1800) -> raises ValueError
mod.api = lambda p: GOOD_RUN if p.endswith('/runs/555') else {'artifacts': [{'id': 9, 'name': ART_NAME, 'expired': False, 'size_in_bytes': 1024}]}
short_soak = {**GOOD_CERT, 'soakSeconds': 600}
mod.command = lambda *a: make_zip(short_soak, GOOD_COMPAT)
try:
    mod.backup(REPO, SHA, LIMIT, STATUS)
    results['shortSoak'] = 'UNEXPECTED_PASS'
except Exception as exc:
    results['shortSoak'] = f'{type(exc).__name__}:{exc}'

# Case F: Valid bundle passes cleanly (proving harness tests the real validator)
mod.command = lambda *a: make_zip(GOOD_CERT, GOOD_COMPAT)
good = mod.backup(REPO, SHA, LIMIT, STATUS)
results['valid'] = {'runId': good['runId'], 'artifactId': good['artifactId']}

print(json.dumps(results))
`;
      const proc = spawnSync('python3', ['-B', '-c', harness], { encoding: 'utf8' });
      expect(proc.status, proc.stderr).toBe(0);
      const out = JSON.parse(proc.stdout);
      expect(out.expired.returnedNone).toBe(true);
      expect(out.expired.refused.length).toBeGreaterThan(0);
      expect(out.corruptZip).toBe('BadZipFile');
      expect(out.corruptJson).toBe('JSONDecodeError');
      expect(out.oversized).toContain('ValueError:unexpected Backup evidence bundle');
      expect(out.shortSoak).toContain(
        'ValueError:successful Backup run conflicts with certificate contents'
      );
      expect(out.valid).toEqual({ runId: 555, artifactId: 9 });
    });
  });

  describe('3. America/Chicago DST spring-forward (2026-03-08) and fall-back (2026-11-01) cycle boundaries', () => {
    it('maintains exact UTC cutoffs, fold=0 fall-back determinism, and cross-script parity across all 8 cycles', () => {
      const py = `
import importlib.util, json

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

sel = load('sel', ${JSON.stringify(SELECT_DAILY)})
nxt = load('nxt', ${JSON.stringify(NEXT_CAND)})

HOURS = ('01', '04', '07', '10', '13', '16', '19', '22')
out = {}
for day in ('2026-03-08', '2026-11-01'):
    cycles = []
    for hh in HOURS:
        cid = f'{day}T{hh}'
        start = nxt.cycle_start(cid)
        cut = sel.cycle_cutoff(cid)
        wait_at_cutoff, target = nxt.plan(cid, cut)
        cycles.append({
            'id': cid,
            'start': start,
            'cutoff': cut,
            'target': target,
            'waitAtCutoff': wait_at_cutoff,
            'label': nxt.cycle_label(start),
        })
    out[day] = {
        'plainCutoff': sel.cutoff(day),
        'plainStart': nxt.cycle_start(day),
        'cycles': cycles,
    }
print(json.dumps(out))
`;
      const proc = spawnSync('python3', ['-B', '-c', py], { encoding: 'utf8' });
      expect(proc.status, proc.stderr).toBe(0);
      const data = JSON.parse(proc.stdout);

      // Spring-forward: 2026-03-08 (02:00 CST jumps to 03:00 CDT)
      const spring = data['2026-03-08'];
      const sp01 = spring.cycles[0]; // 2026-03-08T01 -> 01:00 CST = 07:00Z
      const sp04 = spring.cycles[1]; // 2026-03-08T04 -> 04:00 CDT = 09:00Z
      expect(sp01.start).toBe(Date.parse('2026-03-08T07:00:00Z') / 1000);
      expect(sp01.cutoff).toBe(Date.parse('2026-03-08T06:30:00Z') / 1000);
      expect(sp01.label).toBe('1:00 AM CST');
      expect(sp04.start).toBe(Date.parse('2026-03-08T09:00:00Z') / 1000);
      expect(sp04.cutoff).toBe(Date.parse('2026-03-08T08:30:00Z') / 1000);
      expect(sp04.label).toBe('4:00 AM CDT');
      // Only 2 real wall-clock hours elapse between 01:00 CST and 04:00 CDT.
      expect(sp04.start - sp01.start).toBe(2 * 3600);
      expect(spring.plainCutoff).toBe(sp04.cutoff);
      expect(spring.plainStart).toBe(sp04.start);

      // Fall-back: 2026-11-01 (01:00 AM repeats: fold=0 is 01:00 CDT = 06:00Z, fold=1 is 01:00 CST = 07:00Z)
      const fall = data['2026-11-01'];
      const fb01 = fall.cycles[0]; // MUST resolve to first occurrence (fold=0, CDT = 06:00Z)
      const fb04 = fall.cycles[1]; // 04:00 CST = 10:00Z
      expect(fb01.start).toBe(Date.parse('2026-11-01T06:00:00Z') / 1000);
      expect(fb01.cutoff).toBe(Date.parse('2026-11-01T05:30:00Z') / 1000);
      expect(fb01.label).toBe('1:00 AM CDT');
      expect(fb04.start).toBe(Date.parse('2026-11-01T10:00:00Z') / 1000);
      expect(fb04.cutoff).toBe(Date.parse('2026-11-01T09:30:00Z') / 1000);
      expect(fb04.label).toBe('4:00 AM CST');
      // 4 real wall-clock hours elapse between 01:00 CDT (fold=0) and 04:00 CST.
      expect(fb04.start - fb01.start).toBe(4 * 3600);
      expect(fall.plainCutoff).toBe(fb04.cutoff);
      expect(fall.plainStart).toBe(fb04.start);

      // Universal invariants across all 8 cycles on both DST dates:
      for (const day of ['2026-03-08', '2026-11-01']) {
        const cycles = data[day].cycles;
        for (let i = 0; i < cycles.length; i += 1) {
          const c = cycles[i];
          expect(c.cutoff, c.id).toBe(c.start - 1800);
          expect(c.target, c.id).toBe(c.start + 25 * 60);
          expect(c.waitAtCutoff, c.id).toBe(55 * 60);
          if (i > 0) {
            expect(c.start, `${c.id} > prev`).toBeGreaterThan(cycles[i - 1].start);
          }
        }
      }
    });
  });

  describe('4. CONTROL_INPUTS blast-radius parity check', () => {
    it('proves every Wave A-4 deliverable stays strictly outside CONTROL_INPUTS in both JS and Python', () => {
      const pySource = readFileSync(PREQUAL_PY, 'utf8');
      const parsedLists = parseControlLists(pySource);
      const liveLists = controlLists();
      expect(liveLists.CONTROL_INPUTS).toEqual(parsedLists.CONTROL_INPUTS);

      for (const relPath of WAVE_A4_FILES) {
        expect(isReleaseControlPath(relPath, parsedLists), relPath).toBe(false);
        expect(isReleaseControlPath(relPath, liveLists), relPath).toBe(false);
        const directMatch = parsedLists.CONTROL_INPUTS.some(
          (inp) => relPath === inp || relPath.startsWith(`${inp}/`)
        );
        expect(directMatch, `${relPath} must not fall under CONTROL_INPUTS`).toBe(false);
      }

      // Sanity check: actual control files ARE still classified true (guard cannot be a no-op)
      expect(isReleaseControlPath('scripts/ci/select-daily-engine.py', parsedLists)).toBe(true);
      expect(isReleaseControlPath('.github/workflows/backup-engine.yml', parsedLists)).toBe(true);
    });
  });
});
