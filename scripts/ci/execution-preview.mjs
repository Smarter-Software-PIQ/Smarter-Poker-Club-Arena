import { appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { classifyGitChanges, classifyChangedPaths } from './classify-ci-changes.mjs';
import { executionPlan } from './agent-execution.mjs';
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) }).trim();
const head = process.env.CI_HEAD_SHA || git('rev-parse', 'HEAD');
const base = process.env.CI_BASE_SHA || git('rev-parse', 'origin/main');
let classification = classifyGitChanges({ cwd: root, base, head });
if (process.argv.includes('--working-tree') && classification.complete) {
  const pending = git('diff', '--name-only', '--no-renames', '-z', 'HEAD', '--').split('\0').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const paths = [...new Set([...classification.paths, ...pending, ...untracked])].sort();
  classification = { ...classification, paths, flags: classifyChangedPaths(paths), source: 'working-tree-advisory-only' };
}
const plan = executionPlan({ root, classification });
const selected = plan.checks.filter(c => c.selected).map(c => c.id);
const summary = `Execution preview (shadow): ${selected.join(', ')}. Components: ${plan.components.join(', ') || 'unknown'}. Required gates unchanged.`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
if (!process.env.GITHUB_ACTIONS) {
  const destination = resolve(git('rev-parse', '--git-path', 'agent-execution-plan.json'));
  const temporary = `${destination}.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, destination);
}
