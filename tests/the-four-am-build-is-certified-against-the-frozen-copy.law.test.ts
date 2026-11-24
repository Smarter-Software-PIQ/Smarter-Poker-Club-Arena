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
    expect(sql).toMatch(
      new RegExp(
        `\\(v_day::timestamp \\+ interval ''?${fromMidnight} minutes''?\\) AT TIME ZONE c_tz`
      )
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

// O17 (2026-11-23): under the three-hourly cadence the 01:00 Chicago cycle
// seals inside the freeze, so the serving engine can already contain the
// night's baseline. The 04:00 selector only walks commits after the serving
// release, so certifying such a baseline is a wasted soak on the one host.
describe('O17: a freeze baseline the serving engine already contains is not owed', () => {
  const plan = workflow.slice(workflow.indexOf('      - id: plan'));

  function py(code: string): any {
    const script = [
      'import importlib.util, json',
      'from datetime import datetime',
      `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(ROOT, 'scripts/ci/backup-freeze-baseline.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      `clock = m.clock_of(open(${JSON.stringify(join(ROOT, 'scripts/ci/merged-migration-dispatch.mjs'))}).read(), open(${JSON.stringify(join(ROOT, 'scripts/ci/select-daily-engine.py'))}).read())`,
      code,
    ].join('\n');
    return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
  }

  it('answers served before reading any certificate or control selectability', () => {
    const out = py(`
now = datetime.fromisoformat('2026-11-23T07:10:00+00:00')
base = 'b' * 40
called = []
verdict = m.decide(
  now, clock, lambda u: base, lambda sha, st: called.append('certified') or False,
  control_selectable=lambda b: called.append('control') or True,
  served_contains=lambda b: True,
)
print(json.dumps({'verdict': verdict, 'called': called}))
`);
    expect(out.verdict).toEqual({
      state: 'served',
      baseline: 'b'.repeat(40),
      freezeStart: '2026-11-23T05:45:00Z',
    });
    expect(out.called).toEqual([]);
  });

  it('a baseline the serving engine lacks, or an unreadable answer, plans exactly as before', () => {
    for (const answer of ['False', 'None']) {
      const out = py(`
now = datetime.fromisoformat('2026-11-23T07:10:00+00:00')
verdict = m.decide(now, clock, lambda u: 'b' * 40, lambda sha, st: False, served_contains=lambda b: ${answer})
print(json.dumps(verdict))
`);
      expect(out.state, answer).toBe('due');
    }
    // The historical four-argument call still works and never asks.
    expect(decide('2026-11-23T07:10:00Z').state).toBe('due');
  });

  it('replays tonight: c0706e2b3563 contains baseline 8d4a7ef726d9, 735299cd5fda does not', () => {
    const out = py(`
base = '8d4a7ef726d95ecd0424d56499800470bc5c7bf8'
statuses = {'c0706e2b35631627a88dc26aec4bce830c3ec615': 'ahead', '735299cd5fda6b59c43d1379371d1a3dfb1a050f': 'behind'}
def compare(b, h):
    return statuses[h]
def boom(b, h):
    raise RuntimeError('HTTP 502')
print(json.dumps({
  'sealed_past': m.contains(base, 'c0706e2b35631627a88dc26aec4bce830c3ec615', compare),
  'serving_older': m.contains(base, '735299cd5fda6b59c43d1379371d1a3dfb1a050f', compare),
  'same': m.contains(base, base, boom),
  'diverged': m.contains(base, 'c' * 40, lambda b, h: 'diverged'),
  'odd_answer': m.contains(base, 'c' * 40, lambda b, h: 'weird'),
  'unreadable_compare': m.contains(base, 'c' * 40, boom),
  'unreadable_health': m.contains(base, None, compare),
  'unreadable_url': m.serving_release('http://127.0.0.1:9/health', timeout=2),
}))
`);
    expect(out).toEqual({
      sealed_past: true,
      serving_older: false,
      same: true,
      diverged: false,
      odd_answer: null,
      unreadable_compare: null,
      unreadable_health: null,
      unreadable_url: null,
    });
  });

  it('is wired into main() read-only, and the plan job treats served as plan-as-before', () => {
    expect(reader).toContain('served_contains=served_contains,');
    expect(reader).toContain("HEALTH_URL = 'https://engine.smarter.poker/health'");
    expect(reader).toContain("method='GET'");
    expect(reader).toContain("/compare/{base}...{head}', '--jq', '.status'");
    // The plan job acts only on due, claimed and unselectable.
    expect(plan).toContain(
      'if [ "$baseline_state" = due ] && [[ "$baseline" =~ ^[0-9a-f]{40}$ ]]; then'
    );
    expect(plan).not.toContain('"$baseline_state" = served');
  });
});

// O22 (2026-11-24): the advance stopped at the first migration commit even
// though every migration before the 05:45Z freeze start was already installed,
// so the night's first push claimed 329332c24c32 (20 hours old, refused at
// 02:07Z, missing the hand-gap fix 74d10c32eb6a). A migration proven installed
// before the freeze starts no longer stops the advance; an unproven one does.
describe('O22: the advance crosses migrations installed before the freeze', () => {
  const plan = workflow.slice(workflow.indexOf('      - id: plan'));
  const applier = read('.github/workflows/apply-merged-migration.yml');
  const intent = read('scripts/ci/dispatch-intent.mjs');

  function py(code: string): any {
    const script = [
      'import importlib.util, json, copy',
      'from datetime import datetime',
      `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(ROOT, 'scripts/ci/backup-freeze-baseline.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      `prequal_text = open(${JSON.stringify(join(ROOT, 'scripts/ci/read-engine-prequalification.py'))}).read()`,
      `clock = m.clock_of(open(${JSON.stringify(join(ROOT, 'scripts/ci/merged-migration-dispatch.mjs'))}).read(), open(${JSON.stringify(join(ROOT, 'scripts/ci/select-daily-engine.py'))}).read())`,
      code,
    ].join('\n');
    return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
  }

  // Main's first-parent history after the pre-freeze baseline on 2026-11-24
  // (UTC), and the Apply Merged Migration runs GitHub listed for that night.
  const NIGHT = `
spec_doc = m.parse_control_spec(prequal_text)
PRE = '329332c24c3228ab7a65b4581abc9f2fb6fe0101'
FIX = '74d10c32eb6a441abb6a4862c5bd5da3688e9177'
SRV = '9e7e824c6f6750ef946351c73e986bfdca4d91f2'
HISTORY = [
  ('7ac45e4bb09fab0ffacb3d8a62bf3d720d3a2148', '2026-11-24T01:36:24Z', ['supabase/migrations/20261124004000_promo_wallet_sends_follow_promo_chip_rules.sql']),
  ('8315292e32f4af2f50c9376c6bbaed31a68989cf', '2026-11-24T01:36:55Z', ['supabase/migrations/20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql']),
  ('f3691fbe60973c96c3ff5a46d7a7e99fb3dbfff3', '2026-11-24T01:56:22Z', ['supabase/migrations/20261124010800_weekly_club_statement_reads_gross_original_rake.sql']),
  ('bf145233e093a81f0cc22bd9e35a2b54c274dccd', '2026-11-24T04:10:50Z', ['supabase/migrations/20261124022200_harden_gross_original_rake_fallbacks_and_own_agent.sql']),
  ('f660333f54845d3bbab89116d9b53c874573c126', '2026-11-24T04:46:38Z', ['src/services/GameServerAPI.ts']),
  ('18a4e2476f400194b563d6de7a10618d06168fdb', '2026-11-24T05:00:57Z', ['supabase/migrations/20261124042000_harden_promo_wallet_invariants.sql']),
  ('9d793d9bf8d5a1072e5624ed3a208e4777019ec6', '2026-11-24T05:15:12Z', ['scripts/ops/horse-decision-crossbuild-replay.mjs']),
  ('fa8939f1c7d27538229fcca72ac744ba2985e480', '2026-11-24T05:16:20Z', ['.agent/handoffs/2026-11-23-antigravity-coordinator-HANDOFF-PROMPT.md']),
  (SRV, '2026-11-24T05:20:48Z', ['server/src/engine/HorseOptionShadowStage.ts']),
  ('d749a61e4c944cd46552272dec2739d13b8f86c9', '2026-11-24T05:24:25Z', ['supabase/migrations/20261124041800_stall_watch_v3_thaw_boundary.sql']),
  (FIX, '2026-11-24T05:29:48Z', ['server/src/engine/ServerTableEngineDealing.ts', 'server/src/engine/noUnintendedDelayBetweenHands.law.test.ts']),
  ('bf6fb356036e373515d27be981b3989b157d8b83', '2026-11-24T05:32:08Z', ['docs/ops/option-people-impact.md']),
  ('edbb10cf765335a2b636849e09decaf9ea3cc3f0', '2026-11-24T05:54:39Z', ['supabase/migrations/20261124051600_harden_must_move_upward_ladder_all_doors.sql']),
]
commits, parent = [], PRE
for sha, date, _ in HISTORY:
    commits.append({'sha': sha, 'parents': [{'sha': parent}], 'commit': {'committer': {'date': date}}})
    parent = sha
COMPARE = {'status': 'ahead', 'total_commits': len(commits), 'commits': commits}
FILES = {sha: [{'filename': f, 'status': 'added' if f.startswith('supabase/migrations/') else 'modified'} for f in fs] for sha, _, fs in HISTORY}
BOT = {'login': 'github-actions[bot]'}
def run(rid, file, created, updated, event='repository_dispatch', who=BOT, nonce='0123456789abcdef0123456789abcdef', attempt=1):
    return {'id': rid, 'event': event, 'status': 'completed', 'conclusion': 'success', 'run_attempt': attempt,
            'actor': who, 'triggering_actor': who, 'created_at': created, 'updated_at': updated,
            'display_title': 'Apply Merged Migration ' + file + ((' ' + nonce) if nonce else '')}
RUNS = [
  run(45333181931, '20261124041800_stall_watch_v3_thaw_boundary.sql', '2026-11-24T05:25:11Z', '2026-11-24T05:26:01Z'),
  run(45331298341, '20261124042000_harden_promo_wallet_invariants.sql', '2026-11-24T05:09:31Z', '2026-11-24T05:11:38Z', event='workflow_dispatch', who={'login': 'Smarter-Poker'}, nonce=''),
  run(45330691625, '20261124042000_harden_promo_wallet_invariants.sql', '2026-11-24T05:04:12Z', '2026-11-24T05:05:07Z'),
  run(45324648226, '20261124022200_harden_gross_original_rake_fallbacks_and_own_agent.sql', '2026-11-24T04:11:31Z', '2026-11-24T04:12:38Z'),
  run(45309651494, '20261124010800_weekly_club_statement_reads_gross_original_rake.sql', '2026-11-24T02:04:16Z', '2026-11-24T02:05:10Z'),
  run(45306423709, '20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql', '2026-11-24T01:37:37Z', '2026-11-24T01:39:07Z'),
  run(45306359769, '20261124004000_promo_wallet_sends_follow_promo_chip_rules.sql', '2026-11-24T01:37:05Z', '2026-11-24T01:37:55Z'),
]
FREEZE = datetime.fromisoformat('2026-11-24T05:45:00+00:00')
NOW = datetime.fromisoformat('2026-11-24T05:46:00+00:00')
def proof(runs):
    return lambda name, not_before: m.migration_install_proven(runs, name, not_before, FREEZE)
def advance(runs=RUNS, files=FILES, installed='proof'):
    kw = {} if installed is None else {'migration_installed': proof(runs)}
    return m.find_zero_migration_advance(PRE, COMPARE, lambda s: files[s], spec_doc, **kw)
`;

  it('replays 2026-11-24 05:46Z: every pre-freeze migration installed, so the baseline is 74d10c32eb6a', () => {
    const out = py(`${NIGHT}
seen = []
verdict = m.decide(
  NOW, clock, lambda until: PRE, lambda sha, st: seen.append(sha) or False,
  advance_zero_migration=lambda b: advance(),
  control_selectable=lambda b: True,
  served_contains=lambda b: False,
)
print(json.dumps({'verdict': verdict, 'seen': seen, 'old_rule': advance(installed=None), 'fix': FIX, 'pre': PRE}))
`);
    expect(out.old_rule).toBe(out.pre);
    expect(out.verdict).toEqual({
      state: 'due',
      baseline: out.fix,
      freezeStart: '2026-11-24T05:45:00Z',
    });
    expect(out.seen).toEqual([out.fix]);
  });

  it('an unproven or unreadable install stops the advance at that commit, exactly as before', () => {
    const out = py(`${NIGHT}
no_041800 = [r for r in RUNS if r['id'] != 45333181931]
manual_only = [r for r in RUNS if r['id'] != 45330691625]
modified = copy.deepcopy(FILES)
modified['d749a61e4c944cd46552272dec2739d13b8f86c9'][0]['status'] = 'modified'
rerun = copy.deepcopy(RUNS); rerun[0]['run_attempt'] = 2
no_nonce = copy.deepcopy(RUNS); no_nonce[0]['display_title'] = 'Apply Merged Migration 20261124041800_stall_watch_v3_thaw_boundary.sql'
print(json.dumps({
  'missing_run': advance(no_041800),
  'manual_dispatch_only': advance(manual_only),
  'modified_file': advance(files=modified),
  'rerun_attempt': advance(rerun),
  'no_intent_nonce': advance(no_nonce),
  'unreadable_runs': advance(None),
  'no_proof_reader': advance(installed=None),
  'srv': SRV, 'pre': PRE,
  'unreadable_direct': m.migration_install_proven(None, 'x.sql', FREEZE, FREEZE),
}))
`);
    expect(out.missing_run).toBe(out.srv);
    // 18a4e2476f40 is proven only by the manual workflow_dispatch: not proof.
    expect(out.manual_dispatch_only).toBe(out.pre);
    expect(out.modified_file).toBe(out.srv);
    expect(out.rerun_attempt).toBe(out.srv);
    expect(out.no_intent_nonce).toBe(out.srv);
    expect(out.unreadable_runs).toBe(out.pre);
    expect(out.no_proof_reader).toBe(out.pre);
    expect(out.unreadable_direct).toBeNull();
  });

  it('an install that completed at or after the freeze start, or before its commit, proves nothing', () => {
    const out = py(`${NIGHT}
late = copy.deepcopy(RUNS); late[0]['updated_at'] = '2026-11-24T05:45:00Z'
early = copy.deepcopy(RUNS); early[0]['created_at'] = '2026-11-24T05:24:00Z'
held = copy.deepcopy(RUNS) + [run(1, '20261124051600_harden_must_move_upward_ladder_all_doors.sql', '2026-11-24T10:20:00Z', '2026-11-24T10:21:00Z')]
print(json.dumps({'late': advance(late), 'before_commit': advance(early), 'held': advance(held), 'srv': SRV, 'fix': FIX}))
`);
    expect(out.late).toBe(out.srv);
    expect(out.before_commit).toBe(out.srv);
    // edbb10cf7653 (05:54Z) is held by the freeze: it installs after 04:15 Chicago.
    expect(out.held).toBe(out.fix);
  });

  it('a baseline its own claim run refused after the freeze began is refused, not claimed again', () => {
    const out = py(`
start = datetime.fromisoformat('2026-11-24T05:45:00+00:00')
url = 'https://github.com/o/r/actions/runs/'
claim = {'context': m.CONTEXT, 'state': 'pending', 'created_at': '2026-11-24T05:54:51Z',
         'description': "Backup Engine claimed tonight's freeze baseline (run 45336597819)", 'target_url': url + '45336597819'}
soak = {'context': m.CONTEXT, 'state': 'pending', 'created_at': '2026-11-24T06:10:00Z',
        'description': 'Backup Engine is building, booting and soaking this version', 'target_url': url + '45336597819'}
def fail(desc, rid='45336597819', at='2026-11-24T07:00:00Z'):
    return {'context': m.CONTEXT, 'state': 'failure', 'created_at': at, 'description': desc, 'target_url': url + rid}
old = fail('Backup Engine refused: hand_gap_unintended_delay_exceeded', '45302827099', '2026-11-24T02:07:21Z')
noturn = {'context': m.CONTEXT, 'state': 'error', 'created_at': '2026-11-24T06:01:43Z', 'target_url': url + '45336597819',
          'description': 'Backup Engine reached no verdict: this run never held the Backup host turn, so it tested nothing. See run.'}
ended = lambda rid: 'completed'
cs = lambda rows: m.certification_state(rows, start, ended)
refused_rows = [fail('Backup Engine refused: hand_gap_unintended_delay_exceeded'), soak, claim, old]
print(json.dumps({
  'refused': cs(refused_rows),
  'refused_before_freeze_only': cs([old]),
  'no_verdict': cs([noturn, claim, old]),
  'no_named_reason': cs([fail('Backup Engine refused: see run'), soak, claim]),
  'other_run': cs([fail('Backup Engine refused: hand_gap_unintended_delay_exceeded', '999'), claim]),
  'no_claim': cs([fail('Backup Engine refused: hand_gap_unintended_delay_exceeded')]),
  'success_wins': cs([dict(soak, state='success', created_at='2026-11-24T08:00:00Z')] + refused_rows),
  'decide': m.decide(datetime.fromisoformat('2026-11-24T08:00:00+00:00'), clock, lambda u: 'a' * 40, lambda sha, st: cs(refused_rows)),
}))
`);
    expect(out.refused).toBe('refused');
    expect(out.refused_before_freeze_only).toBe('due');
    expect(out.no_verdict).toBe('due');
    expect(out.no_named_reason).toBe('due');
    expect(out.other_run).toBe('due');
    expect(out.no_claim).toBe('due');
    expect(out.success_wins).toBe('done');
    expect(out.decide).toEqual({
      state: 'refused',
      baseline: 'a'.repeat(40),
      freezeStart: '2026-11-24T05:45:00Z',
    });
  });

  it('the proof it trusts is what the applier guarantees, and main() wires it read-only and bounded', () => {
    // A github-actions[bot] repository_dispatch must prove its recorded intent,
    // and that intent pins dry_run=false: such a run that succeeded installed.
    expect(applier).toMatch(
      /run-name: Apply Merged Migration \$\{\{ inputs\.migration \|\| github\.event\.client_payload\.migration \}\}\$\{\{ github\.event\.client_payload\.intent_nonce && format\(' \{0\}', github\.event\.client_payload\.intent_nonce\)/
    );
    expect(applier).toContain(
      "if: ((endsWith(github.actor, '[bot]') && github.actor != 'smarter-poker-autopilot[bot]') || (endsWith(github.triggering_actor, '[bot]') && github.triggering_actor != 'smarter-poker-autopilot[bot]')) && github.event_name == 'repository_dispatch'"
    );
    expect(applier).toContain(
      'node "$RUNNER_TEMP/dispatch-intent.mjs" prove --receiver apply-merged-migration'
    );
    expect(applier).toContain('0) echo "- result: **APPLIED, ALREADY-APPLIED or BOUNDED PAGES**');
    expect(applier).toContain('test "$code" = "0"');
    expect(intent).toMatch(/dry_run: \{ required: true, test: \(v\) => v === false \}/);
    expect(reader).toContain("INSTALL_WORKFLOW = 'apply-merged-migration.yml'");
    expect(reader).toContain('migration_installed=migration_installed,');
    expect(reader).toMatch(/MAX_ADVANCE_COMMIT_READS = \d+/);
    expect(reader).toContain(
      '&status=success&exclude_pull_requests=true&per_page={INSTALL_RUNS_MAX}'
    );
    // `refused` is not `due`: the plan job plans exactly as before.
    expect(plan).toContain(
      'if [ "$baseline_state" = due ] && [[ "$baseline" =~ ^[0-9a-f]{40}$ ]]; then'
    );
    expect(plan).not.toContain('"$baseline_state" = refused');
  });
});
