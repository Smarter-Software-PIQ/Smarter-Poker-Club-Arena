/**
 * LAW: unfinished work is never proposed and never auto-merged.
 *
 * Ported from World Hub (2026-11-27, PR #3170). An agent pushed
 * `bookmark/video-library-smarterdesign-2026-11-27` as a handoff bookmark, head
 * commit "wip(video-library): bookmark ... unfinished, see handoff". Agent
 * Branch Proposal signalled it, Agent Open PR opened #3170 for it, and Agent
 * Autopilot armed protected squash auto-merge, which landed unapproved UI in
 * production.
 *
 * Both halves now call `.github/scripts/unfinished-work-guard.sh`. This runs
 * the real script, so it tests what the script DOES, and reads the real
 * workflows, so neither half can stop calling it.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const GUARD = join(ROOT, '.github', 'scripts', 'unfinished-work-guard.sh');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function guard(branch: string, subject: string, draft?: boolean, labels?: string) {
  const args = [GUARD, branch, subject];
  if (draft !== undefined || labels !== undefined) args.push(String(draft ?? false));
  if (labels !== undefined) args.push(labels);
  const res = spawnSync('bash', args, { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('LAW: unfinished work is never proposed and never auto-merged', () => {
  it('the exact PR #3170 branch and head commit are held', () => {
    const r = guard(
      'bookmark/video-library-smarterdesign-2026-11-27',
      'wip(video-library): bookmark 2026-11-27 lane C mid-pass (explanations to help, de-nest frames); unfinished, see handoff'
    );
    expect(r.status, r.out).toBe(10);
  });

  it('bookmark/, wip/ and handoff/ branches are held whatever the commit says', () => {
    for (const branch of [
      'bookmark/x',
      'wip/x',
      'handoff/x',
      'WIP/x',
      'agent/claude/bookmark/x',
      'agent/claude/handoff-2026-11-27',
    ]) {
      const r = guard(branch, 'fix(header): keep the help icon in place');
      expect(r.status, `${branch}\n${r.out}`).toBe(10);
    }
  });

  it('a head commit marked wip, bookmark:, handoff: or [do-not-ship] is held on any branch', () => {
    for (const subject of [
      'wip: half a header',
      'WIP(video): frames',
      '[WIP] frames',
      'wip',
      'bookmark: lane C mid-pass',
      'Bookmark(video): resume here',
      'handoff: lane C',
      'handoff(video): resume here',
      'do-not-ship: experiment',
      '[do-not-ship] experiment',
      'chore: probe [do-not-ship]',
      'feat(video): frames [DO-NOT-SHIP]',
    ]) {
      const r = guard('agent/claude/video-frames', subject);
      expect(r.status, `${subject}\n${r.out}`).toBe(10);
    }
  });

  it('the bare words bookmark and unfinished in a real feature do not hold it', () => {
    for (const subject of [
      'feat(video-library): bookmark timestamps',
      'fix: resume unfinished tournaments',
      'feat(video): save a bookmark for the next agent',
      'docs: Bookmark for lane C',
      'refactor: frames (unfinished)',
      'feat(hub): handoff between tables',
      'fix: do not ship stale cache',
    ]) {
      const r = guard('agent/claude/video-library-bookmarks', subject);
      expect(r.status, `${subject}\n${r.out}`).toBe(0);
    }
  });

  it('a do-not-ship label holds a PR; the older hold labels still hold it', () => {
    for (const labels of [
      'do-not-ship',
      'enhancement,do-not-ship',
      'Do-Not-Ship',
      'ui, do-not-ship ',
      'do-not-merge',
      'hold',
      'wip',
    ]) {
      const r = guard('agent/claude/ready-work', 'fix: ready work', false, labels);
      expect(r.status, `${labels}\n${r.out}`).toBe(10);
      expect(r.out).toMatch(/label/);
    }
    for (const labels of ['', 'enhancement', 'shipping', 'do-not-ship-later']) {
      const r = guard('agent/claude/ready-work', 'fix: ready work', false, labels);
      expect(r.status, `${JSON.stringify(labels)}\n${r.out}`).toBe(0);
    }
  });

  it('a draft pull request is held, so it can never be auto-merged', () => {
    const r = guard('agent/claude/ready-work', 'fix: ready work', true);
    expect(r.status, r.out).toBe(10);
    expect(r.out).toMatch(/draft/);
  });

  it('finished work on an ordinary agent branch still proceeds', () => {
    for (const [branch, subject] of [
      ['agent/claude/header-help', 'fix(header): keep the help icon in place'],
      ['fix/wipe-stale-cache', 'fix: wipe stale cache entries'],
      [
        'agent/claude-evidence/evidence/header-help-2026-11-27',
        'evidence: screenshots for PR #3168',
      ],
    ]) {
      const r = guard(branch, subject, false);
      expect(r.status, `${branch} / ${subject}\n${r.out}`).toBe(0);
    }
  });

  it('a missing branch is a usage error, never a pass', () => {
    const r = guard('', 'fix: x');
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBe(10);
  });

  it('Agent Branch Proposal does not even signal for bookmark/, handoff/ or wip/', () => {
    const proposal = parse(read('.github/workflows/agent-branch-proposal.yml')) as {
      on?: { push?: { 'branches-ignore'?: string[] } };
    };
    const ignored = proposal.on?.push?.['branches-ignore'] ?? [];
    for (const p of ['bookmark/**', 'handoff/**', 'wip/**']) {
      expect(ignored, p).toContain(p);
    }
  });

  it('Agent Open PR refuses held prefixes and runs the guard before gh pr create', () => {
    const openPr = read('.github/workflows/agent-open-pr.yml')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    for (const p of ['bookmark', 'handoff', 'wip']) {
      expect(openPr, p).toMatch(
        new RegExp(`!startsWith\\(github\\.event\\.workflow_run\\.head_branch, '${p}/'\\)`)
      );
    }
    const guardIdx = openPr.indexOf('.github/scripts/unfinished-work-guard.sh');
    const createIdx = openPr.indexOf('gh pr create');
    expect(guardIdx, 'guard must be present').toBeGreaterThan(0);
    expect(createIdx, 'guard must run before gh pr create').toBeGreaterThan(guardIdx);
    expect(openPr.slice(guardIdx, createIdx)).toMatch(/"\$HOLD_RC" = "10"[\s\S]*?exit 0/);
  });

  it('Agent Autopilot arms auto-merge only after the guard says the PR is not held', () => {
    const raw = read('.github/workflows/agent-autopilot.yml');
    const wf = parse(raw) as Record<string, any>;
    const types: string[] = wf.on?.pull_request_target?.types ?? [];
    expect(types, 'a PR turned back to draft must be disarmed').toContain('converted_to_draft');
    for (const t of ['labeled', 'unlabeled']) {
      expect(types, `labelling must re-run the guard (${t})`).toContain(t);
    }

    const classify = wf.jobs?.classify;
    expect(classify, 'classify job must exist').toBeDefined();
    expect(classify.environment).toBeUndefined();
    const guardStep = (classify.steps ?? []).find((s: any) =>
      String(s.run ?? '').includes('unfinished-work-guard.sh')
    );
    expect(guardStep, 'classify must run unfinished-work-guard.sh').toBeDefined();
    expect(String(guardStep.run)).toContain(
      'bash .github/scripts/unfinished-work-guard.sh "$BRANCH" "$SUBJECT" "$DRAFT" "$LABELS"'
    );
    expect(guardStep.env?.LABELS).toBe("${{ join(github.event.pull_request.labels.*.name, ',') }}");

    const queue = wf.jobs?.['queue-pr'];
    expect(queue.needs).toBe('classify');
    expect(queue.environment).toBe('github-app-main');
    expect(String(queue.if)).toContain("needs.classify.outputs.hold == 'false'");
    expect(String(queue.if)).toContain('github.event.pull_request.draft == false');

    const hold = wf.jobs?.['hold-unfinished-work'];
    expect(hold, 'hold-unfinished-work job must exist').toBeDefined();
    expect(hold.needs).toBe('classify');
    expect(hold.environment).toBe('github-app-main');
    expect(String(hold.if)).toContain("needs.classify.outputs.hold == 'true'");
    const holdRun = (hold.steps ?? []).map((s: any) => String(s.run ?? '')).join('\n');
    expect(holdRun).toContain('--disable-auto');
    expect(holdRun, 'the hold job never merges anything').not.toContain('--squash');
  });
});
