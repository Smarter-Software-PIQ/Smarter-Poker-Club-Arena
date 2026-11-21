/**
 * Run immediately before a squash merge: `npx tsx scripts/switch-list-fresh-at-merge.ts <head sha>` (from server/).
 * Fetches origin main, then refuses (exit 1) a head whose switch list migration does not follow main's newest list
 * (src/engine/horseDecision/switchListFreshAtMerge.ts). Exit 0: fresh, or the head adds no switch list migration.
 */
import { execFileSync } from 'node:child_process';
import {
  switchListStaleAtMerge,
  type GitRun,
} from '../src/engine/horseDecision/switchListFreshAtMerge.js';

const head = process.argv[2];
if (!head || !/^[0-9a-f]{7,40}$/.test(head)) {
  console.error('usage: switch-list-fresh-at-merge.ts <head sha>');
  process.exit(2);
}
const git: GitRun = (args) =>
  execFileSync('git', ['-C', '..', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
git(['fetch', '-q', 'origin', 'main']);
const problem = switchListStaleAtMerge(git, head);
if (problem) {
  console.error(`REFUSED: ${head} must not merge: ${problem}`);
  process.exit(1);
}
console.log(`OK: ${head} switch list follows origin/main's newest (or adds none)`);
