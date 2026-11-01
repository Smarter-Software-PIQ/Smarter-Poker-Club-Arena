/**
 * LAW: PRESENT, EMPTY, ABSENT AND UNREADABLE ARE FOUR ANSWERS, NOT ONE
 * ═══════════════════════════════════════════════════════════════════════════
 * CLAUDE.md 10.86, rules 1 and 2, applied to the estate audit's own reads.
 *
 * MEASURED 2026-09-23. `gh api .../contents/<path> --jq .content` does not go
 * quiet on a 404. It exits 1 and prints the error body on STDOUT:
 *
 *   {"message":"Not Found","documentation_url":"...","status":"404"}
 *
 * estate-integrity.sh tested only whether that capture was empty, so a
 * 127-byte error counted as a present file, `base64 -d` refused it and wrote
 * nothing, and the digest came out `e3b0c442...` - the sha256 of the empty
 * string. The audit then reported "is a ZERO-BYTE FILE" about two paths that
 * did not exist at all: Diamond-Arena had DELETED both of them on purpose in
 * its own PR #64, which in the same commit added a test there to keep them
 * retired.
 *
 * Three facts, three owners, three opposite repairs, one name between them.
 * And the consequence was not cosmetic: the absent sentinel carried the
 * deletion's commit date, joined the "most recently committed" ranking and
 * WON it for agent-open-pr.yml - so the report told every reader that the
 * newest authoritative copy of the estate's pull-request opener was nothing,
 * and listed the six repos that actually have a working one as "carrying
 * something else". An agent obeying that line would have deleted the opener
 * from six repositories.
 *
 * This pins each outcome to its own sentence, and pins the ranking against
 * ever naming a non-variant as the newest content.
 */
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const AUDIT = resolve(ROOT, '.github/scripts/estate-integrity.sh');
const sandboxes: string[] = [];

/** base64 of "guard\n" - the content every healthy repo returns here. */
const GUARD_B64 = 'Z3VhcmQK';

type Mode = 'retired' | 'resurrected';

/**
 * A fake `gh` that reproduces the REAL failure shape rather than a tidy one:
 * a 404 prints its JSON body to stdout and exits 1, which is exactly how the
 * bug got in. Diamond-Arena 404s, PepNationLab returns a genuinely empty file
 * (GitHub sends `"content": ""` for one), and workers fails with a 500 that
 * says nothing about Not Found.
 *
 * PepNationLab and Diamond-Arena both carry the LATEST commit dates, so if
 * either a zero-byte file or a deleted path could win the "most recently
 * committed" ranking, this fixture makes it win.
 */
async function runAudit(mode: Mode, deadline: number, auditScript = AUDIT) {
  const sandbox = mkdtempSync(join(tmpdir(), 'estate-integrity-absent-'));
  sandboxes.push(sandbox);
  const bin = join(sandbox, 'bin');
  const summary = join(sandbox, 'summary.md');
  mkdirSync(bin);

  const fakeGh = join(bin, 'gh');
  writeFileSync(
    fakeGh,
    [
      '#!/usr/bin/env bash',
      'set -u',
      '',
      'not_found() {',
      '  printf \'{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}\\n\'',
      '  exit 1',
      '}',
      '',
      'case "${1:-}" in',
      '  api)',
      '    endpoint="${2:-}"',
      '    case "$endpoint" in',
      '      */commits\\?path=*)',
      '        case "$endpoint" in',
      '          *PepNationLab*)                printf \'[{"commit":{"committer":{"date":"2026-12-31T00:00:00Z"}}}]\\n\' ;;',
      '          *Smarter-Poker-Diamond-Arena*) printf \'[{"commit":{"committer":{"date":"2026-12-30T00:00:00Z"}}}]\\n\' ;;',
      '          *Smarter-Poker-Club-Arena*)    printf \'[{"commit":{"committer":{"date":"2026-11-01T00:00:00Z"}}}]\\n\' ;;',
      '          *)                             printf \'[{"commit":{"committer":{"date":"2026-10-01T00:00:00Z"}}}]\\n\' ;;',
      '        esac',
      '        ;;',
      // A SWITCHED-OFF WORKFLOW IS NOT A LIVE ONE (2026-10-02). Section 3 reads
      // the workflow's state before it judges a run, so every fixture has to
      // answer this endpoint. Here every repo's autopilot is enabled, which
      // leaves this law's subject - present/empty/absent/unreadable CONTENT -
      // the only thing under test.
      '      */actions/workflows)',
      '        WF_JSON=\'{"total_count":1,"workflows":[{"id":2,"name":"Agent Autopilot","path":".github/workflows/agent-autopilot.yml","state":"active"}]}\'',
      '        shift 2',
      '        if [ "${1:-}" = --jq ]; then printf \'%s\' "$WF_JSON" | jq -r "${2:-.}"; else printf \'%s\\n\' "$WF_JSON"; fi',
      '        ;;',
      '      */contents/*)',
      '        case "$endpoint" in',
      '          *smarter-poker-workers*)',
      '            printf \'{"message":"Server Error","status":"500"}\\n\'; exit 1 ;;',
      '          *PepNationLab*)',
      "            printf '\\n' ;;",
      '          *Smarter-Poker-Diamond-Arena*)',
      '            case "${ESTATE_FIXTURE_MODE:?}" in',
      '              resurrected)',
      '                case "$endpoint" in',
      "                  *agent-open-pr.yml*) printf 'GUARD_B64_TOKEN\\n' ;;",
      '                  *) not_found ;;',
      '                esac',
      '                ;;',
      '              *) not_found ;;',
      '            esac',
      '            ;;',
      "          *) printf 'GUARD_B64_TOKEN\\n' ;;",
      '        esac',
      '        ;;',
      '      */rulesets)',
      '        printf \'[{"id":101,"target":"branch"}]\\n\' ;;',
      '      */rulesets/101)',
      '        printf \'{"id":101,"target":"branch","enforcement":"active","bypass_actors":[],"rules":[{"type":"non_fast_forward"},{"type":"deletion"},{"type":"pull_request"},{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"Build"}]}}]}\\n\' ;;',
      '      */git/trees/*)',
      '        printf \'{"tree":[]}\\n\' ;;',
      '      repos/Smarter-Poker/*)',
      "        printf 'main\\n' ;;",
      '      *) exit 64 ;;',
      '    esac',
      '    ;;',
      "  run)    printf 'completed/success\\n' ;;",
      '  issue)  [ "${2:-}" = list ] || printf \'fixture issue write accepted\\n\' ;;',
      '  *) exit 64 ;;',
      'esac',
      '',
    ]
      .join('\n')
      .split('GUARD_B64_TOKEN')
      .join(GUARD_B64)
  );
  chmodSync(fakeGh, 0o755);

  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
      let stdout = '';
      let stderr = '';
      let failure: Error | undefined;
      let settled = false;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn('bash', [auditScript], {
        cwd: ROOT,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ESTATE_INJECT_REPO: 'Smarter-Poker-Diamond-Arena',
          ESTATE_INJECT_RETIRED_PATH1:
            '.github/workflows/agent-autopilot.yml|Smarter-Poker-Diamond-Arena|test',
          ESTATE_INJECT_RETIRED_PATH2:
            '.github/workflows/agent-open-pr.yml|Smarter-Poker-Diamond-Arena|test',
          ...process.env,
          ESTATE_FIXTURE_MODE: mode,
          GH_TOKEN: 'fixture-read-token',
          GH_TOKEN_ISSUES: 'fixture-issue-token',
          GITHUB_REPOSITORY: 'Smarter-Poker/Smarter-Poker-Club-Arena',
          GITHUB_STEP_SUMMARY: summary,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
        },
      });
      const finish = (status: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadlineTimer);
        clearTimeout(cleanupTimer);
        if (failure) reject(failure);
        else resolveResult({ status, stdout, stderr });
      };
      const terminate = (error: Error) => {
        if (settled || failure) return;
        failure = error;
        // Kill while the child is alive, including descendants holding pipes.
        // A synchronous wait cannot enforce this when a shell traps SIGTERM.
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch (killError) {
          if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') failure = killError as Error;
        }
        cleanupTimer = setTimeout(
          () => {
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            finish(null);
          },
          Math.max(1, Math.min(2_000, deadline + 2_000 - performance.now()))
        );
      };
      const capture = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        if (target === 'stdout') stdout += chunk.toString();
        else stderr += chunk.toString();
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1024 * 1024) {
          terminate(new Error('Estate fixture output exceeded its existing one MiB bound'));
        }
      };
      const deadlineTimer = setTimeout(
        () => terminate(new Error('Estate fixture exceeded the shared execution deadline')),
        Math.max(1, deadline - performance.now())
      );
      child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
      child.on('error', terminate);
      child.on('close', finish);
    }
  );

  const report = existsSync(summary) ? readFileSync(summary, 'utf8') : '';
  return { result, report, combined: `${result.stdout}\n${result.stderr}\n${report}` };
}

afterAll(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

// Three assertions consumed the identical retired-mode report, repeating the
// full seven-repository audit. Under contention one run took37.459s despite
// passing unchanged in7.57s/10.45s for the two modes in isolation. Run each
// distinct mode once within the original four-test80s aggregate budget, leaving
// two seconds for cleanup. Every output assertion and its20s limit stays.
const audits = new Map<Mode, Awaited<ReturnType<typeof runAudit>>>();
beforeAll(async () => {
  const deadline = performance.now() + 78_000;
  for (const mode of ['retired', 'resurrected'] as const) {
    audits.set(mode, await runAudit(mode, deadline));
  }
}, 80_000);

describe('LAW - the estate audit never calls a missing file an empty one', () => {
  it('reports an absent path as absent, an empty file as empty and an unreadable read as unknown', () => {
    const { result, combined } = audits.get('retired')!;

    expect(result.status).toBe(1);

    // A path that 404s is GONE. It is never described as zero bytes, because
    // restoring a deleted file and filling an empty one are different jobs
    // with different owners.
    expect(combined).not.toContain('ZERO-BYTE');
    expect(combined).not.toContain('RECORDED AS RETIRED');
    expect(combined).toMatch(/missing from:[^\n]*Smarter-Poker-Diamond-Arena/);

    // A file that exists and holds nothing keeps its own sentence.
    expect(combined).toContain('exists and is EMPTY');
    expect(combined).toMatch(/`[^`]+` in \*\*PepNationLab\*\* exists and is EMPTY/);

    // A read that failed for any other reason is COULD NOT TELL - never
    // folded into present, absent or empty (10.86 rule 1).
    expect(combined).toContain('COULD NOT TELL');
    expect(combined).toMatch(/in \*\*smarter-poker-workers\*\* — COULD NOT TELL/);
  }, 20_000);

  it('never names a deleted path or a zero-byte file as the most recently committed copy', () => {
    const { combined } = audits.get('retired')!;

    const leads = combined.match(/Most recently committed: \*\*[^*]+\*\* \([^)]*\)/g) ?? [];
    expect(leads.length, 'the ranking line disappeared entirely').toBeGreaterThan(0);

    // PepNationLab holds the latest date in this fixture and a zero-byte file;
    // Diamond-Arena holds the second latest and no file at all. Neither may be
    // held up as the copy the rest of the estate should converge on.
    for (const lead of leads) {
      expect(lead, 'a non-variant was ranked as the newest content').not.toContain('PepNationLab');
      expect(lead, 'a deleted path was ranked as the newest content').not.toContain(
        'Smarter-Poker-Diamond-Arena'
      );
    }
  }, 20_000);

  it('names the variant that is deliberate, so nobody repairs the wrong repo', () => {
    const { combined } = audits.get('retired')!;

    expect(combined).toContain('Recorded deliberate variant');
    // Club Arena's reference-transaction hook is preventive on purpose and its
    // own unit test forbids the snapshotting variant. Copying a newer-dated
    // file over it would ship a red test and a band-aid CLAUDE.md 10.12 bans.
    expect(combined).toContain('resetGuardCannotSaveTheWorktree');
  }, 20_000);

  it('alarms if a recorded retirement is reversed without the record being updated', () => {
    const { result, combined } = audits.get('resurrected')!;

    expect(result.status).toBe(1);
    expect(combined).toContain('RECORDED AS RETIRED');
    expect(combined).toContain('it is back');
  }, 20_000);
});

it('retires a timed-out fixture process group even when it ignores TERM and holds pipes', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'estate-fixture-timeout-'));
  sandboxes.push(sandbox);
  const script = join(sandbox, 'hold-pipes.sh');
  const pids = join(sandbox, 'pids');
  writeFileSync(
    script,
    `#!/usr/bin/env bash
trap '' TERM
sleep 60 &
printf '%s %s' "$$" "$!" > '${pids}'
wait
`
  );
  const started = performance.now();
  await expect(runAudit('retired', started + 1_000, script)).rejects.toThrow(
    'Estate fixture exceeded the shared execution deadline'
  );
  expect(performance.now() - started).toBeLessThan(4_000);
  const pid = Number(readFileSync(pids, 'utf8').split(' ')[0]);
  const groupExists = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      return false;
    }
  };
  const reapedBy = performance.now() + 2_000;
  while (groupExists() && performance.now() < reapedBy) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  expect(groupExists(), 'the retired fixture still owns a process group').toBe(false);
}, 20_000);
