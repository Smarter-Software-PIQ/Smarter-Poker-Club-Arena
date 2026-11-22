/**
 * THE 04:00 BUILD IS CERTIFIED AGAINST THE FROZEN COPY (incident 076ff467,
 * EngineCutoverMissed fired 2026-11-16, 17, 18 and 19).
 *
 * Every 03:30 selection those mornings answered keep-serving: certificates
 * made before the last pre-freeze install held a stale copy, and candidates
 * merged inside the release schema freeze carried migrations the freeze holds
 * until 04:15. The one run meant to certify the shippable build on a fresh
 * copy (the 00:01 nightly schedule) was delivered by GitHub 7-10 hours late on
 * every day checked. These laws pin the replacement:
 *
 *   1. the Backup plan job asks scripts/ci/backup-freeze-baseline.py first,
 *      and a `due` answer certifies that exact build with the refresh forced,
 *      before any superseded / retarget / already-certified step can skip it;
 *   2. the reader's window is derived from the dispatcher's freeze start and
 *      the selector's own 03:30 cutoff,
 *      and a run started at its last minute still finishes before 03:30;
 *   3. the cutover watch owes the same build (freeze start minus SETTLE);
 *   4. the 2026-11-19 night replays as `due` inside the freeze and `outside`
 *      before it and after the last useful start.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const workflow = read('.github/workflows/backup-engine.yml');
const reader = read('scripts/ci/backup-freeze-baseline.py');
const dispatcher = read('scripts/ci/merged-migration-dispatch.mjs');

const num = (re: RegExp, text: string) => {
  const m = re.exec(text);
  if (!m) throw new Error(`not found: ${re}`);
  return m.slice(1).map(Number);
};
const [freezeH, freezeM] = num(
  /RELEASE_SCHEMA_FREEZE_CHICAGO\s*=\s*\{\s*from:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/,
  dispatcher
);
const selector = read('scripts/ci/select-daily-engine.py');
const [selH, selM] = num(
  /def cutoff\(day\):\s*\n\s*return [\s\S]*?time\((\d+),\s*(\d+)\)/,
  selector
);
const [runWorst] = num(/BACKUP_RUN_WORST_MINUTES\s*=\s*(\d+)/, reader);
const [settle] = num(/SETTLE\s*=\s*timedelta\(minutes=(\d+)\)/, reader);

function decide(nowIso: string): Record<string, string> {
  const script = [
    'import importlib.util, json, sys',
    'from datetime import datetime',
    `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(ROOT, 'scripts/ci/backup-freeze-baseline.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `clock = m.clock_of(open(${JSON.stringify(join(ROOT, 'scripts/ci/merged-migration-dispatch.mjs'))}).read(), open(${JSON.stringify(join(ROOT, 'scripts/ci/select-daily-engine.py'))}).read())`,
    `now = datetime.fromisoformat(${JSON.stringify(nowIso)}.replace('Z', '+00:00'))`,
    "print(json.dumps(m.decide(now, clock, lambda until: 'a' * 40, lambda sha, start: False)))",
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}

describe('the Backup certifies the build the freeze can ship', () => {
  const plan = workflow.slice(workflow.indexOf('      - id: plan'));

  it('asks the freeze-baseline reader before anything can supersede or skip the run', () => {
    const ask = plan.indexOf('scripts/ci/backup-freeze-baseline.py?ref=main');
    expect(ask).toBeGreaterThan(0);
    for (const later of [
      'SUPERSEDED:',
      'RETARGETED:',
      'ALREADY CERTIFIED:',
      'inherit_eligible=true',
    ]) {
      expect(plan.indexOf(later)).toBeGreaterThan(ask);
    }
  });

  it('a due answer certifies exactly that build with the copy refreshed, and stops planning', () => {
    const block = plan.slice(
      plan.indexOf('if [ "$baseline_state" = due ]'),
      plan.indexOf('SUPERSEDED:')
    );
    expect(block).toContain('echo "sha=$baseline" >> "$GITHUB_OUTPUT"');
    expect(block).toContain('echo "refresh=force" >> "$GITHUB_OUTPUT"');
    expect(block).toContain('exit 0');
    expect(block).not.toContain('inherit_eligible');
  });

  it('only push and schedule runs ask, and any other answer plans as before', () => {
    expect(plan).toContain('if [ "$EVENT" = push ] || [ "$EVENT" = schedule ]; then');
    expect(plan).toMatch(/baseline_state=unknown/);
  });
});

describe('the reader follows the dispatcher release clock', () => {
  it('a run started at the window end still certifies before the selection reads', () => {
    const windowEnd = selH * 60 + selM - runWorst;
    expect(windowEnd + runWorst).toBeLessThanOrEqual(selH * 60 + selM);
    // The freeze may start the evening before (23:45): place it on the same
    // timeline as the window end, minutes from the cutover date's midnight.
    const start = freezeH * 60 + freezeM;
    expect(windowEnd).toBeGreaterThan(start >= 12 * 60 ? start - 24 * 60 : start);
  });

  it('replays the 2026-11-19 night against the dispatcher clock', () => {
    // Chicago is UTC-6 on 2026-11-19. Instants one minute either side of the
    // freeze start and of the window end, read from the dispatcher clock.
    const end = selH * 60 + selM - runWorst;
    const start = freezeH * 60 + freezeM;
    const utc = (chicagoMinutes: number) => {
      const day = chicagoMinutes < 12 * 60 ? 19 : 18; // morning of the 19th, evening of the 18th
      const t = new Date(Date.UTC(2026, 10, day, 6, 0, 0) + chicagoMinutes * 60_000);
      return t.toISOString().replace('.000Z', 'Z');
    };
    expect(decide(utc(start - 1)).state).toBe('outside');
    const due = decide(utc(start + 1));
    expect(due.state).toBe('due');
    expect(due.baseline).toBe('a'.repeat(40));
    expect(decide(utc(end - 1)).state).toBe('due');
    expect(decide(utc(end + 1)).state).toBe('outside');
    expect(decide('2026-11-19T18:00:00Z').state).toBe('outside');
  });
});

describe('the cutover watch owes the same build', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('ca_cutover_owed_build(v_serving'))
    .pop()!;
  const sql = readFileSync(join(dir, latest), 'utf8');

  it('reads the owed build at freeze start minus SETTLE, counted from the cutover date midnight', () => {
    // A freeze that starts in the evening (23:45) belongs to the night before
    // the cutover date: its offset from that date's midnight is negative.
    const start = freezeH * 60 + freezeM;
    const fromMidnight = (start >= 12 * 60 ? start - 24 * 60 : start) - settle;
    expect(sql).toContain(
      `(v_day::timestamp + interval ''${fromMidnight} minutes'') AT TIME ZONE c_tz`
    );
  });
});

describe('O6: freeze-baseline zero-migration advance and CONTROL_INPUTS selectability', () => {
  const plan = workflow.slice(workflow.indexOf('      - id: plan'));

  function py(code: string): any {
    const script = [
      'import importlib.util, json',
      'from datetime import datetime',
      `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(ROOT, 'scripts/ci/backup-freeze-baseline.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      `prequal_text = open(${JSON.stringify(join(ROOT, 'scripts/ci/read-engine-prequalification.py'))}).read()`,
      `clock = m.clock_of(open(${JSON.stringify(join(ROOT, 'scripts/ci/merged-migration-dispatch.mjs'))}).read(), open(${JSON.stringify(join(ROOT, 'scripts/ci/select-daily-engine.py'))}).read())`,
      code,
    ].join('\n');
    return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
  }

  it('parses CONTROL_INPUTS dynamically from read-engine-prequalification.py and respects O4 pure-test exclusions', () => {
    const out = py(`
spec_doc = m.parse_control_spec(prequal_text)
results = {
  'backup_yml': m.is_non_test_control_path('.github/workflows/backup-engine.yml', spec_doc),
  'prequal_py': m.is_non_test_control_path('scripts/ci/read-engine-prequalification.py', spec_doc),
  'manifest': m.is_non_test_control_path('scripts/ci/recorded-migrations.manifest.json', spec_doc),
  'prod_script': m.is_non_test_control_path('server/scripts/engine-release-installed-migrations.py', spec_doc),
  'prod_maint': m.is_non_test_control_path('server/src/maintenance/MaintenanceBreak.ts', spec_doc),
  'test_py_suffix': m.is_non_test_control_path('server/scripts/foo.test.py', spec_doc),
  'test_py_prefix': m.is_non_test_control_path('server/scripts/test_foo.py', spec_doc),
  'test_maint_law': m.is_non_test_control_path('server/src/maintenance/MaintenanceBreak.law.test.ts', spec_doc),
  'unrelated_server': m.is_non_test_control_path('server/src/engine/TableEngine.ts', spec_doc),
  'docs': m.is_non_test_control_path('docs/README.md', spec_doc),
}
print(json.dumps(results))
`);
    expect(out).toEqual({
      backup_yml: true,
      prequal_py: true,
      manifest: true,
      prod_script: true,
      prod_maint: true,
      test_py_suffix: false,
      test_py_prefix: false,
      test_maint_law: false,
      unrelated_server: false,
      docs: false,
    });
  });

  it('replays 2026-11-22 07:50:31Z: advances across zero-migration CONTROL_INPUTS/server prefix and stops before first migration', () => {
    const out = py(`
spec_doc = m.parse_control_spec(prequal_text)
pre = '0' * 40
c_docs = '1' * 40
c_o4 = '2' * 40
c_o1 = '3' * 40
c_o5 = '4' * 40
c_srv = '5' * 40
c_mig = '6' * 40
c_after = '7' * 40
compare = {
  'status': 'ahead',
  'total_commits': 7,
  'commits': [
    {'sha': c_docs, 'parents': [{'sha': pre}]},
    {'sha': c_o4, 'parents': [{'sha': c_docs}]},
    {'sha': c_o1, 'parents': [{'sha': c_o4}]},
    {'sha': c_o5, 'parents': [{'sha': c_o1}]},
    {'sha': c_srv, 'parents': [{'sha': c_o5}]},
    {'sha': c_mig, 'parents': [{'sha': c_srv}]},
    {'sha': c_after, 'parents': [{'sha': c_mig}]},
  ],
}
files_by_sha = {
  c_docs: [{'filename': 'docs/horse-option-authority.d/x.md'}],
  c_o4: [{'filename': 'scripts/ci/read-engine-prequalification.py'}],
  c_o1: [{'filename': '.github/workflows/backup-engine.yml'}],
  c_o5: [{'filename': '.github/workflows/stage-engine-release.yml'}],
  c_srv: [{'filename': 'server/src/engine/HorsePlayStyles.law.test.ts'}],
  c_mig: [{'filename': 'supabase/migrations/20261122025656_share_previews.sql'}],
  c_after: [{'filename': 'server/src/tournament/TournamentManager.ts'}],
}
advanced = m.find_zero_migration_advance(pre, compare, lambda s: files_by_sha[s], spec_doc)
# Compare from advanced (c_srv) to main has only migration + unrelated server file -> selectable!
selectable_after_adv = m.is_control_selectable({
  'status': 'ahead',
  'files': files_by_sha[c_mig] + files_by_sha[c_after],
}, spec_doc)
# Compare from old pre_freeze (0a3a6a5211db) to main has CONTROL_INPUTS changes -> NOT selectable!
selectable_old = m.is_control_selectable({
  'status': 'ahead',
  'files': files_by_sha[c_o4] + files_by_sha[c_o1] + files_by_sha[c_mig],
}, spec_doc)
# Full decide replay at 2026-11-22T07:50:31Z
now = datetime.fromisoformat('2026-11-22T07:50:31+00:00')
seen = []
verdict_fixed = m.decide(
  now, clock, lambda u: pre, lambda sha, st: seen.append(sha) or False,
  advance_zero_migration=lambda b: advanced,
  control_selectable=lambda b: selectable_after_adv,
)
print(json.dumps({
  'advanced': advanced,
  'expected': c_srv,
  'selectable_after_adv': selectable_after_adv,
  'selectable_old': selectable_old,
  'verdict_fixed': verdict_fixed,
  'certified_after_called_with': seen,
}))
`);
    expect(out.advanced).toBe(out.expected);
    expect(out.selectable_after_adv).toBe(true);
    expect(out.selectable_old).toBe(false);
    expect(out.verdict_fixed.state).toBe('due');
    expect(out.verdict_fixed.baseline).toBe(out.expected);
    expect(out.certified_after_called_with).toEqual([out.expected]);
  });

  it('returns state=unselectable before calling certified_after when CONTROL_INPUTS diverged after a migration', () => {
    const out = py(`
now = datetime.fromisoformat('2026-11-22T07:50:31+00:00')
pre = 'a' * 40
called = []
verdict = m.decide(
  now, clock, lambda u: pre, lambda sha, st: called.append(sha) or False,
  advance_zero_migration=lambda b: pre,
  control_selectable=lambda b: False,
)
print(json.dumps({'verdict': verdict, 'called': called}))
`);
    expect(out.verdict.state).toBe('unselectable');
    expect(out.verdict.baseline).toBe('a'.repeat(40));
    expect(out.verdict.why).toBe('control_inputs_diverged');
    expect(out.verdict.freezeStart).toBe('2026-11-22T05:45:00Z');
    expect(out.called).toEqual([]);
  });

  it('fails open when API is unreadable or truncated (CLAUDE.md 10.86) and keeps docs-only prefixes on pre_freeze', () => {
    const out = py(`
spec_doc = m.parse_control_spec(prequal_text)
pre = 'a' * 40
c1 = 'b' * 40
# Docs-only commit in zero-migration prefix keeps pre_freeze unchanged.
docs_only = m.find_zero_migration_advance(
  pre,
  {'status': 'ahead', 'total_commits': 1, 'commits': [{'sha': c1, 'parents': [{'sha': pre}]}]},
  lambda s: [{'filename': 'docs/foo.md'}],
  spec_doc,
)
# Truncated compare (> 250 commits) fails open to pre_freeze.
truncated_adv = m.find_zero_migration_advance(
  pre,
  {'status': 'ahead', 'total_commits': 251, 'commits': [{'sha': c1, 'parents': [{'sha': pre}]}]},
  lambda s: [{'filename': 'server/src/x.ts'}],
  spec_doc,
)
# Pure O4 test file diff stays selectable=True.
pure_test_sel = m.is_control_selectable(
  {'status': 'ahead', 'files': [{'filename': 'server/scripts/foo.test.py'}, {'filename': 'server/src/maintenance/x.law.test.ts'}]},
  spec_doc,
)
# Truncated compare files (>= 300 with no control match) fails open to None.
truncated_sel = m.is_control_selectable(
  {'status': 'ahead', 'files': [{'filename': f'docs/f{i}.md'} for i in range(300)]},
  spec_doc,
)
# Diverged compare fails open to None.
diverged_sel = m.is_control_selectable({'status': 'diverged', 'files': []}, spec_doc)
# None from control_selectable fails open to existing certified_after behavior.
now = datetime.fromisoformat('2026-11-22T07:50:31+00:00')
verdict_open = m.decide(
  now, clock, lambda u: pre, lambda sha, st: False,
  advance_zero_migration=lambda b: None,
  control_selectable=lambda b: None,
)
print(json.dumps({
  'docs_only': docs_only,
  'truncated_adv': truncated_adv,
  'pure_test_sel': pure_test_sel,
  'truncated_sel': truncated_sel,
  'diverged_sel': diverged_sel,
  'verdict_open': verdict_open,
}))
`);
    expect(out.docs_only).toBe('a'.repeat(40));
    expect(out.truncated_adv).toBe('a'.repeat(40));
    expect(out.pure_test_sel).toBe(true);
    expect(out.truncated_sel).toBeNull();
    expect(out.diverged_sel).toBeNull();
    expect(out.verdict_open.state).toBe('due');
    expect(out.verdict_open.baseline).toBe('a'.repeat(40));
  });

  it('backup-engine.yml logs unselectable freeze baseline and falls through cleanly to ordinary planning', () => {
    const unsel = plan.indexOf('if [ "$baseline_state" = unselectable ]; then');
    const due = plan.indexOf('if [ "$baseline_state" = due ]');
    expect(unsel).toBeGreaterThan(0);
    expect(unsel).toBeLessThan(due);
    expect(plan).toContain(
      'FREEZE BASELINE: $baseline is unselectable (CONTROL_INPUTS diverged from main); skipping wasted certification and planning as before.'
    );
    // Execute the plan step with a mocked backup-freeze-baseline.py returning state=unselectable.
    const pushed = 'c'.repeat(40);
    const oldBaseline = '0'.repeat(40);
    const planStep = workflow
      .slice(workflow.indexOf('      - id: plan'))
      .split('\n        run: |\n')[1]
      .split('\n      # The identity needs')[0]
      .replace(/^ {10}/gm, '');
    const out = execFileSync(
      'bash',
      [
        '-c',
        `set -euo pipefail
out=$(mktemp); sum=$(mktemp); trap 'rm -f "$out" "$sum"' EXIT
export GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY="$sum"
gh() {
  case "$*" in
    *contents/scripts/ci/backup-freeze-baseline.py*)
      printf '%s\\n' "print('state=unselectable')" "print('baseline=${oldBaseline}')" "print('why=control_inputs_diverged')" ;;
    *contents/scripts/ci/backup-candidate-priority.py*)
      printf '%s\\n' "print('priority=none')" ;;
    *actions/workflows/backup-engine.yml/runs*) echo 0 ;;
    *'/commits?sha=main&path=server&per_page=1'*) echo '${pushed}' ;;
    *'/statuses'*) echo missing ;;
    *) return 1 ;;
  esac
}
${planStep}
cat "$out"
echo "---SUMMARY---"
cat "$sum"`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          EVENT: 'push',
          INPUT_SHA: '',
          INPUT_REFRESH: 'false',
          SEALED_SHA: '',
          GITHUB_SHA: pushed,
          RUN_ID: '900',
          GITHUB_REPOSITORY: 'o/r',
          STATUS_CONTEXT: 'backup-engine/certified',
        },
      }
    );
    expect(out).toContain(
      `FREEZE BASELINE: ${oldBaseline} is unselectable (CONTROL_INPUTS diverged from main); skipping wasted certification and planning as before.`
    );
    expect(out).toContain(`sha=${pushed}`);
    expect(out).toContain('refresh=auto');
    expect(out).not.toContain('freeze_baseline=1');
    expect(out).toContain(`FREEZE BASELINE \`${oldBaseline}\`: unselectable`);
  });
});
