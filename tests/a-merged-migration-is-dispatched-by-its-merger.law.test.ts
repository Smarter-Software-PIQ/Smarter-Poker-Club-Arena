/**
 * LAW: A MERGED MIGRATION IS DISPATCHED BY ITS MERGER (2026-10-25).
 *
 * apply-merged-migration.yml is dispatch-only: "THE READER is the person who
 * dispatches it". The autopilot App merges pull requests itself, so for an
 * automatically merged PR there was no person and nothing dispatched it. PR
 * #7971 merged at 01:48 UTC on 2026-10-25 with
 * 20261024231549_lightning_voided_hand_returns_its_blind_stamps.sql, and the
 * file sat uninstalled until a hand dispatch at 02:30 UTC.
 *
 * 2026-11-07: the job lived in agent-autopilot.yml, which is disabled by owner
 * instruction, so it never ran: #9858 and #9957 (merged by GitHub auto-merge
 * armed by the owner account) left their migrations uninstalled. It now has
 * its own workflow, dispatch-merged-migrations.yml, for every merge.
 *
 * What this pins:
 *   1. The dispatch lives in its own workflow, on the native `closed` event of
 *      a merged same-repository PR into the default branch; no timer, no
 *      workflow_run watcher, no repository_dispatch trigger of its own - and
 *      not in the disabled autopilot workflow.
 *   2. It uses the job's own token and acts on every such merge, whoever
 *      merged it.
 *   3. One repository_dispatch per added migration file, filename order,
 *      client_payload {migration, dry_run: false}, never retried.
 *   4. "-- @install-window: daily-maintenance" files are skipped by the
 *      applier's own classifier and named in the summary.
 *   5. Inside the :50-:03 UTC window (and the daily 04:00 Chicago break) it
 *      waits once, bounded, BEFORE sending anything; beyond the bound it sends
 *      nothing, names the files and fails, so no file is silently left behind.
 *   6. apply-merged-migration.yml is still dispatch-only and unchanged in its
 *      triggers.
 *   7. (2026-11-08) A migration the PR MODIFIED is dispatched too: #10026 and
 *      #10029 fixed 20261108011659 in place after its install was refused,
 *      and nothing dispatched it. The applier answers ALREADY-APPLIED (exit 0,
 *      nothing sent) for an installed version, so this is harmless; a removed
 *      file and a rename's previous_filename are never dispatched.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  WAIT_BUDGET_MINUTES,
  admissibleAt,
  changedPaths,
  earliestDispatch,
  parseFileList,
  planDispatch,
} from '../scripts/ci/merged-migration-dispatch.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const autopilotRaw = read('.github/workflows/agent-autopilot.yml');
const autopilot = parse(autopilotRaw) as Record<string, any>;
const script = read('.github/scripts/dispatch-merged-migrations.sh');
const scriptCode = script
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
const applier = parse(read('.github/workflows/apply-merged-migration.yml')) as Record<string, any>;

const at = (iso: string) => Date.parse(iso);
const ORDINARY = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
const WINDOWED = '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n';
const PREAMBLE =
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_a ON public.hand_history (id);\nBEGIN;\nSELECT 1;\nCOMMIT;\n';

describe('the merge dispatches the migrations it added', () => {
  const workflow = parse(read('.github/workflows/dispatch-merged-migrations.yml')) as Record<
    string,
    any
  >;
  const job = workflow.jobs['dispatch-merged-migrations'];

  it('lives in its own workflow, on the native closed event of a protected merge', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request_target']);
    expect(workflow.on.pull_request_target.types).toEqual(['closed']);
    expect(job).toBeDefined();
    expect(job.if).toContain("github.event.action == 'closed'");
    expect(job.if).toContain('github.event.pull_request.merged == true');
    expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(job.if).toContain(
      'github.event.pull_request.base.ref == github.event.repository.default_branch'
    );
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  it('the publishing law and the agent brief describe the merge that dispatches (2026-11-07)', () => {
    // #9952's migration sat uninstalled after a non-autopilot merge because the
    // written rule still said only the autopilot's merges dispatch.
    for (const doc of [
      'PUBLISHING.md',
      'CLAUDE.md',
      'docs/laws.d/a-merged-migration-is-dispatched-by-its-merger.md',
    ]) {
      const text = read(doc);
      expect(text, doc).toContain('dispatch-merged-migrations.yml');
      expect(text, doc).not.toMatch(
        /autopilot merges a pull request|the autopilot's merge dispatches|after any other merge, dispatch it yourself/
      );
    }
  });

  it('is not left inside the disabled autopilot workflow (2026-11-07)', () => {
    expect(autopilot.jobs['dispatch-merged-migrations']).toBeUndefined();
    expect(autopilot.on.pull_request_target.types).not.toContain('closed');
    expect(autopilotRaw).not.toContain('dispatch-merged-migrations.sh');
  });

  it('uses the job token and dispatches every merge, whoever merged it', () => {
    const step = job.steps.find(
      (s: any) => s.name === 'Dispatch each added or modified migration to the applier'
    );
    expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(step.env.MERGED_BY).toBe('${{ github.event.pull_request.merged_by.login }}');
    expect(step.run).toBe('bash .github/scripts/dispatch-merged-migrations.sh');
    expect(workflow.permissions).toEqual({ contents: 'write', 'pull-requests': 'write' });
    expect(job.steps[0].with.ref).toBe('${{ github.event.repository.default_branch }}');
    // Every merge dispatches its own migrations, whoever merged it (2026-11-07:
    // an agent's hand merge of #9876 left 20261107130652 uninstalled for hours).
    expect(scriptCode).not.toMatch(/MERGED_BY"? != /);
    expect(scriptCode).not.toContain('APP_SLUG');
    expect(scriptCode).toContain('dispatching the migrations it added or modified');
    expect(read('.github/workflows/dispatch-merged-migrations.yml')).not.toMatch(
      /GH_PAT|AUTOFIX_GITHUB_TOKEN|secrets\./
    );
  });

  it('a merge by the owner account reads the PR files instead of stopping (#9957)', () => {
    const box = mkdtempSync(join(tmpdir(), 'merged-dispatch-'));
    try {
      const calls = join(box, 'calls');
      writeFileSync(
        join(box, 'gh'),
        `#!/usr/bin/env bash\necho "$*" >> '${calls}'\ncase "$*" in *pulls/9957/files*) echo docs/x.md ;; esac\n`
      );
      chmodSync(join(box, 'gh'), 0o755);
      const summary = join(box, 'summary');
      const r = spawnSync('bash', ['.github/scripts/dispatch-merged-migrations.sh'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${box}:${process.env.PATH}`,
          GH_TOKEN: 'x',
          REPO: 'o/r',
          PR: '9957',
          MERGED_BY: 'Smarter-Poker',
          GITHUB_STEP_SUMMARY: summary,
          GITHUB_RUN_ID: '1',
        },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(calls, 'utf8')).toContain('repos/o/r/pulls/9957/files?per_page=100');
      const said = readFileSync(summary, 'utf8');
      expect(said).toContain(
        'merged by `Smarter-Poker`; dispatching the migrations it added or modified'
      );
      expect(said).toContain('no ordinary migration to dispatch');
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });

  it('sends one apply-merged-migration dispatch per file, dry_run false, never retried', () => {
    expect(scriptCode).toContain('repos/$REPO/dispatches');
    expect(scriptCode).toContain('-f event_type=apply-merged-migration');
    expect(scriptCode).toContain('-f "client_payload[migration]=$f"');
    expect(scriptCode).toContain('-F "client_payload[dry_run]=false"');
    expect(scriptCode.match(/repos\/\$REPO\/dispatches/g)).toHaveLength(1);
    // Each file is sent with the intent its plan phase recorded (dispatch-intent.mjs).
    expect(scriptCode).toMatch(
      /for f in "\$\{DISPATCH\[@\]\}"; do\n\s+NONCE=\$\(jq [^\n]+\n\s+if \[\[ "\$NONCE" =~ \^\[0-9a-f\]\{32\}\$ \]\] && gh api --method POST/
    );
    expect(scriptCode).toContain('-f "client_payload[intent_nonce]=$NONCE"');
    expect(scriptCode).toMatch(/DISPATCH REFUSED[^\n]*not retried/);
    expect(scriptCode).not.toMatch(/--dry-run|dry_run\]=true|workflow run|actions\/workflows/);
  });

  it('reads only the files the PR added, in filename order, from the default branch', () => {
    expect(scriptCode).toContain('repos/$REPO/pulls/$PR/files?per_page=100');
    const plan = planDispatch(
      [
        'supabase/migrations/20261024231549_b.sql',
        'docs/x.md',
        'supabase/migrations/20261024220000_a.sql',
        'supabase/migrations/not_a_version.sql',
      ],
      () => ORDINARY,
      at('2026-10-25T02:10:00Z')
    );
    expect(plan.dispatch).toEqual(['20261024220000_a.sql', '20261024231549_b.sql']);
    expect(plan.waitSeconds).toBe(0);
  });

  it('skips a daily-maintenance window file and says so', () => {
    const plan = planDispatch(
      ['supabase/migrations/20261024220000_win.sql', 'supabase/migrations/20261024220001_ok.sql'],
      (n) => (n.includes('win') ? WINDOWED : ORDINARY),
      at('2026-10-25T02:10:00Z')
    );
    expect(plan.windowQueued).toEqual(['20261024220000_win.sql']);
    expect(plan.dispatch).toEqual(['20261024220001_ok.sql']);
    expect(scriptCode).toContain('-- @install-window: daily-maintenance');
    expect(read('scripts/ci/merged-migration-dispatch.mjs')).toContain(
      "import { windowDeclaration } from './maintenance-window-migrations.mjs'"
    );
  });

  it('waits out the :50-:03 window before sending, and PR #7971 would have gone at :04', () => {
    // The incident merge: 01:48:24 UTC is two minutes before the window; one
    // file needs three minutes of runway, so it waits to 02:04.
    const merged = at('2026-10-25T01:48:24Z');
    expect(admissibleAt(merged, 1, false)).toBe(false);
    const go = earliestDispatch(merged, 1, false)!;
    expect(new Date(go).toISOString()).toBe('2026-10-25T02:04:09.000Z');
    for (const iso of ['2026-10-25T01:50:00Z', '2026-10-25T02:00:00Z', '2026-10-25T02:03:59Z'])
      expect(admissibleAt(at(iso), 1, false), iso).toBe(false);
    expect(admissibleAt(at('2026-10-25T02:04:00Z'), 1, false)).toBe(true);
    // The send comes after the wait, and the clock is asked again after it.
    const sleep = scriptCode.indexOf('sleep "$WAIT"');
    const recheck = scriptCode.indexOf('node "$PLANNER" admitted');
    const send = scriptCode.indexOf('repos/$REPO/dispatches');
    expect(sleep).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(sleep);
    expect(send).toBeGreaterThan(recheck);
  });

  it('stays clear of the daily 04:00 Chicago break and its release', () => {
    // 04:00 CDT is 09:00 UTC; 04:00 CST is 10:00 UTC.
    expect(admissibleAt(at('2026-10-25T09:05:00Z'), 1, false)).toBe(false);
    expect(admissibleAt(at('2026-10-25T09:10:00Z'), 1, false)).toBe(true);
    expect(admissibleAt(at('2026-12-01T10:06:00Z'), 1, false)).toBe(false);
    expect(admissibleAt(at('2026-12-01T09:06:00Z'), 1, false)).toBe(true);
  });

  it('every ordinary merge fits the bounded wait, whatever the minute', () => {
    let worst = 0;
    for (let t = at('2026-10-25T00:00:00Z'); t < at('2026-10-27T00:00:00Z'); t += 60_000) {
      const go = earliestDispatch(t, 1, false)!;
      worst = Math.max(worst, go - t);
    }
    expect(worst / 60_000).toBeLessThanOrEqual(WAIT_BUDGET_MINUTES);
    expect(WAIT_BUDGET_MINUTES * 60 + 5 * 60).toBeLessThanOrEqual(
      (parse(read('.github/workflows/dispatch-merged-migrations.yml')) as Record<string, any>).jobs[
        'dispatch-merged-migrations'
      ]['timeout-minutes'] * 60
    );
  });

  it('beyond the bound it sends nothing, names the files and fails', () => {
    // A CONCURRENTLY preamble needs 12 minutes before :50 (the applier's
    // PREAMBLE_MINUTES_NEEDED), so a merge at :36 cannot go until :04, past
    // the bound: nothing may be sent.
    const plan = planDispatch(
      ['supabase/migrations/20261024220000_ix.sql'],
      () => PREAMBLE,
      at('2026-10-25T01:36:00Z')
    );
    expect(plan.preamble).toBe(true);
    expect(plan.dispatch).toEqual(['20261024220000_ix.sql']);
    expect(plan.withinBudget).toBe(false);
    const block = scriptCode.slice(
      scriptCode.indexOf("if [ \"$(jq -r '.withinBudget'"),
      scriptCode.indexOf('WAIT=$(jq')
    );
    expect(block).toContain('NOT DISPATCHED (break window)');
    expect(block).toContain('Nothing was sent.');
    expect(block).toContain('::error::');
    expect(block).toContain('exit 1');
    expect(block).not.toContain('repos/$REPO/dispatches');
  });

  it('the applier itself is still dispatch-only', () => {
    const triggers = Object.keys(applier.on).sort();
    expect(triggers).toEqual(['repository_dispatch', 'workflow_dispatch']);
    expect(applier.on.repository_dispatch.types).toEqual(['apply-merged-migration']);
  });
});

describe('a migration the merge MODIFIED is dispatched too (2026-11-08, #10026/#10029)', () => {
  const REFUSED_THEN_FIXED = '20261108011659_v31_public215_v2_sql_encoding_chain.sql';
  const ADDED = '20261108020000_a_job_failing_every_run_is_named.sql';
  const REMOVED = '20261107210000_a_freeze_refusal_is_counted_by_name.sql';
  const RENAMED_AWAY = '20261107210122_v31_db_reads_pio_bet_tokens_as_root_totals.sql';
  const RENAMED_TO = '20261107215049_midway_weekly_terms_supersede_legacy_sixpm_defaults.sql';
  const m = (n: string) => `supabase/migrations/${n}`;

  it('splits the PR file list: added/renamed/copied, modified, and never removed', () => {
    const split = changedPaths([
      { filename: m('20261108000000_a.sql'), status: 'added' },
      { filename: m('20261108000001_b.sql'), status: 'modified' },
      { filename: m('20261108000002_c.sql'), status: 'removed' },
      { filename: m('20261108000003_new.sql'), status: 'renamed' },
      { filename: m('20261108000004_d.sql'), status: 'copied' },
      { filename: m('20261108000005_e.sql'), status: 'changed' },
      { filename: m('20261108000006_f.sql'), status: 'unchanged' },
    ]);
    expect(split.added).toEqual([
      m('20261108000000_a.sql'),
      m('20261108000003_new.sql'),
      m('20261108000004_d.sql'),
    ]);
    expect(split.modified).toEqual([m('20261108000001_b.sql')]);
  });

  it('reads the shell list as status<TAB>path, and a bare path as added', () => {
    expect(
      parseFileList(`modified\t${m('x.sql')}\nadded\t${m('y.sql')}\n\n${m('z.sql')}\n`)
    ).toEqual([
      { status: 'modified', filename: m('x.sql') },
      { status: 'added', filename: m('y.sql') },
      { status: 'added', filename: m('z.sql') },
    ]);
  });

  it('plans added and modified files together in filename order and names the modified ones', () => {
    const plan = planDispatch(
      [m('20261108020000_b.sql'), 'docs/x.md'],
      (n) => (n.includes('gone') ? null : n.includes('win') ? WINDOWED : ORDINARY),
      at('2026-10-25T02:10:00Z'),
      [
        m('20261108011659_a.sql'),
        m('20261108011700_gone.sql'),
        m('20261108011800_win.sql'),
        m('20261108020000_b.sql'),
        'src/x.ts',
      ]
    );
    expect(plan.dispatch).toEqual(['20261108011659_a.sql', '20261108020000_b.sql']);
    // A file both added and modified (one PR cannot, but be exact) counts as added.
    expect(plan.modified).toEqual(['20261108011659_a.sql']);
    expect(plan.notOnMain).toEqual(['20261108011700_gone.sql']);
    expect(plan.windowQueued).toEqual(['20261108011800_win.sql']);
    expect(plan.waitSeconds).toBe(0);
    // Without modified paths the plan is what it always was.
    expect(
      planDispatch([m('20261108020000_b.sql')], () => ORDINARY, at('2026-10-25T02:10:00Z')).modified
    ).toEqual([]);
  });

  it('the merged script dispatches the #10029 shape: modified yes, removed and renamed-away never', () => {
    const box = mkdtempSync(join(tmpdir(), 'merged-dispatch-modified-'));
    try {
      const calls = join(box, 'calls');
      const files = join(box, 'files.json');
      writeFileSync(
        files,
        JSON.stringify([
          { filename: m(REFUSED_THEN_FIXED), status: 'modified' },
          { filename: m(ADDED), status: 'added' },
          { filename: m(REMOVED), status: 'removed' },
          { filename: m(RENAMED_TO), previous_filename: m(RENAMED_AWAY), status: 'renamed' },
          { filename: 'docs/changelog/x.md', status: 'modified' },
        ])
      );
      // A gh that answers the PR file list through the script's own --jq
      // filter (real jq), and records every other call.
      writeFileSync(
        join(box, 'gh'),
        `#!/usr/bin/env bash
echo "$*" >> '${calls}'
case "$*" in
  *pulls/10029/files*)
    while [ $# -gt 0 ]; do [ "$1" = --jq ] && { jq -r "$2" '${files}'; exit; }; shift; done
    exit 9 ;;
esac
`
      );
      chmodSync(join(box, 'gh'), 0o755);
      const summary = join(box, 'summary');
      // Plan records one intent per file; send dispatches exactly those.
      const intents = join(box, 'intents');
      for (const phase of ['plan', 'send']) {
        const r = spawnSync('bash', ['.github/scripts/dispatch-merged-migrations.sh'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${box}:${process.env.PATH}`,
            GH_TOKEN: 'x',
            REPO: 'o/r',
            PR: '10029',
            MERGED_BY: 'Smarter-Poker',
            GITHUB_STEP_SUMMARY: summary,
            GITHUB_RUN_ID: '1',
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_WORKFLOW_REF:
              'o/r/.github/workflows/dispatch-merged-migrations.yml@refs/heads/main',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_EVENT_NAME: 'pull_request_target',
            GITHUB_OUTPUT: join(box, 'output'),
            DISPATCH_PHASE: phase,
            INTENT_DIR: intents,
            INTENT_STATE: join(box, 'state.jsonl'),
            // An admitted minute, so nothing waits.
            DISPATCH_NOW_MS: String(at('2026-10-25T02:10:00Z')),
          },
        });
        expect(r.status, r.stderr + r.stdout).toBe(0);
      }
      expect(readFileSync(join(box, 'output'), 'utf8')).toBe('send=true\n');
      expect(readdirSync(intents)).toHaveLength(3);
      expect(readFileSync(calls, 'utf8')).toMatch(/client_payload\[intent_nonce\]=[0-9a-f]{32}/);
      const sent = readFileSync(calls, 'utf8')
        .split('\n')
        .filter((l) => l.includes('repos/o/r/dispatches'))
        .map((l) => /client_payload\[migration\]=(\S+)/.exec(l)?.[1]);
      expect(sent).toEqual([RENAMED_TO, REFUSED_THEN_FIXED, ADDED]); // filename order
      const said = readFileSync(summary, 'utf8');
      expect(said).toContain(`\`${REFUSED_THEN_FIXED}\` was MODIFIED (not added) by #10029`);
      expect(said).toContain('ALREADY-APPLIED and sends nothing');
      expect(said).not.toContain(REMOVED);
      expect(said).not.toContain(RENAMED_AWAY);
      expect(said).not.toContain('no ordinary migration to dispatch');
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });

  it('relies on the applier, which answers ALREADY-APPLIED for an installed version and sends nothing', () => {
    // The dispatcher holds no database credential; the applier is the one
    // that reads schema_migrations.
    expect(read('.github/workflows/dispatch-merged-migrations.yml')).not.toMatch(/DATABASE_URL/);
    const apply = read('scripts/ci/apply-recorded-migration.mjs');
    expect(apply).toContain('FROM supabase_migrations.schema_migrations');
    expect(apply).toContain('[apply] ALREADY-APPLIED: ${file}');
    expect(apply).toContain("'[apply] Nothing sent. This run changed nothing.'");
    const after = apply.slice(apply.indexOf('if (already.length > 0) {'));
    expect(after.slice(0, after.indexOf('process.exit(EXIT_OK);'))).not.toMatch(
      /client\.query\((?!.*schema_migrations)/
    );
  });

  it('the test clock is never set by the workflow', () => {
    expect(read('.github/workflows/dispatch-merged-migrations.yml')).not.toContain(
      'DISPATCH_NOW_MS'
    );
  });
});
