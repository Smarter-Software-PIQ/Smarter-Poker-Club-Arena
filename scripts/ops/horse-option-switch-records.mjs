// scripts/ops/horse-option-switch-records.mjs
//
// A LIVE SWITCH WRITE BRINGS ITS OWN RECORDS PR (2026-11-24, Antigravity Coordinator).
//
// On 2026-11-24 at about 08:18Z cashDefenceTrimColdCalls was turned on (audit #193), and hours later its
// authority doc still said "State: default OFF" and docs/horse-option-switch-state.json still held the
// 2026-11-23T05:05Z rows (audit max 189). The law tests/an-authority-doc-states-the-live-switch.law.test.ts
// compares docs with that committed snapshot, so it stayed green while production differed. The write
// had come through a private wrapper that calls the switch RPCs directly; the repo tool's `set` only
// rewrote the snapshot in the operator's own checkout, and nothing made anyone commit it.
//
// This module makes the records change a product of the live rows, not of anyone's memory:
//   buildRecordsChange()   pure: from the live rows and the docs on origin/main, the new snapshot text
//                          and every authority doc whose State disagrees, rewritten.
//   defaultOpenRecordsPr() the side effects: a throwaway worktree of origin/main, the files written,
//                          one commit, scripts/agent-push.sh, gh pr create. It never touches the switch.
// `horse-option-switch.mjs records` runs it on demand (any wrapper can call it after its own write), and
// `set` runs it after every verified write. A failure here never undoes or retries the write: it prints
// the one command that finishes the records.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTHORITY_DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN,
  SWITCH_STATE_FILE,
  findAuthorityDocStateDrift,
  findUnjudgedLiveAuthorityDocs,
  formatSwitchStateSnapshot,
  parseAuthorityDocState,
} from './horse-option-switch-lib.mjs';

export const AUTHORITY_DOC_DIR = 'docs/horse-option-authority.d';
export const RECORDS_FINISH_COMMAND = 'node scripts/ops/horse-option-switch.mjs records';

const STATE_TOKEN_RE = /\*\*State:\s*([^*]+?)\s*\*\*/;
// The machine-read evidence phrases holdem-blanket-scoreboard-lib.mjs and the activation tools read.
const EVIDENCE_CLAUSE_RE = /Evidence\s+(?:NOT\s+)?MET\b[^;]*/;

function canonicalStatePhrase(liveState, row) {
  const at = [
    row?.auditId !== null && row?.auditId !== undefined ? `audit #${row.auditId}` : null,
    row?.changedAt ? String(row.changedAt).replace(/\.\d{3}Z$/, 'Z') : null,
  ]
    .filter(Boolean)
    .join(', ');
  const since = at ? ` since ${at}` : '';
  if (liveState === 'on') return `LIVE ON${since}`;
  if (liveState === 'shadow') return `SHADOW${since}`;
  if (liveState === 'on_shadow') return `ON_SHADOW${since}`;
  if (liveState === 'off') return `OFF${since}`;
  return 'OFF (no switch row; release default)';
}

/**
 * Pure. The doc with its first `**State: ...**` token rewritten to say `liveState`. The literal evidence
 * clause ("Evidence MET ..." or "Evidence NOT MET ...") inside the old token is kept word for word, so the
 * scoreboard and activation parsers read the same verdict. Returns null when the doc has no State token.
 */
export function rewriteAuthorityDocState(text, liveState, row = null) {
  const src = String(text ?? '');
  const m = STATE_TOKEN_RE.exec(src);
  if (!m) return null;
  const evidence = EVIDENCE_CLAUSE_RE.exec(m[1]);
  const phrase = canonicalStatePhrase(liveState, row);
  const token = `**State: ${phrase}${evidence ? `; ${evidence[0].trim().replace(/[.\s]+$/, '')}` : ''}.**`;
  return src.slice(0, m.index) + token + src.slice(m.index + m[0].length);
}

/**
 * Pure. The doc with a `**State: ...**` token added at the start of its status paragraph (the first
 * paragraph under the `# ` title, the one parseAuthorityDocEvidence reads), for a doc that has none. The
 * paragraph's own words, its "Evidence MET" / "Evidence NOT MET" claim included, are kept as written.
 * Returns null when the doc already has a State token, has no title, or does not open with a plain
 * paragraph (a heading, list, table, quote or code fence): those are left for a person.
 */
export function insertAuthorityDocState(text, liveState, row = null) {
  const src = String(text ?? '');
  if (STATE_TOKEN_RE.test(src)) return null;
  const lines = src.split('\n');
  let i = lines.findIndex((l) => l.startsWith('# '));
  if (i < 0) return null;
  i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || /^\s*(#|[-*+] |\d+[.)] |\||>|```|~~~)/.test(lines[i])) return null;
  lines[i] = `**State: ${canonicalStatePhrase(liveState, row)}.** ${lines[i]}`;
  return lines.join('\n');
}

/** Pure. True when the committed snapshot text holds the same schema, audit max and rows as `snapshot`. */
function sameSwitchRows(currentStateText, snapshot) {
  let current;
  try {
    current = JSON.parse(currentStateText);
  } catch {
    return false;
  }
  if (!current || typeof current !== 'object') return false;
  const strip = (s) => JSON.parse(formatSwitchStateSnapshot({ ...s, asOfUtc: null }));
  try {
    return (
      current.schema === snapshot.schema &&
      JSON.stringify(strip(current)) === JSON.stringify(strip(snapshot)) &&
      formatSwitchStateSnapshot(current) === currentStateText
    );
  } catch {
    return false;
  }
}

/**
 * Pure. Everything the records PR must carry, from the live snapshot and the docs it judges.
 *   snapshot          snapshotFromRows() of the live rows
 *   docs              { option: text } as on origin/main
 *   currentStateText  docs/horse-option-switch-state.json as on origin/main ('' when absent)
 *   releaseDefaultOn  Set of options whose release default is ON (no row means ON for them)
 * Returns { stateFileText, stateFileChanged, docChanges: [{ option, path, text, from, to }], unresolved }.
 * An option the parser cannot place, or a release-default-ON option with no row, is listed in
 * `unresolved` for a person and never rewritten by guess.
 *
 * A live option whose doc has no readable State is not drift (nothing to compare), yet the law
 * an-authority-doc-states-the-live-switch fails on it unless it is on the closed list
 * AUTHORITY_DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN. On 2026-11-24 omahaPricedRaiseNeverMakesNonNutRaise went
 * live (audits #197, #198) with such a doc: this function reported nothing, and a records PR built from it
 * would have gone red on that law with no word why. Such a doc now gains a State token, or is listed in
 * `unresolved` when one cannot be added safely.
 */
export function buildRecordsChange({
  snapshot,
  docs,
  currentStateText = '',
  releaseDefaultOn = new Set(),
  docsWithoutStateAllowed = AUTHORITY_DOCS_WRITTEN_BEFORE_THE_STATE_TOKEN,
}) {
  // The snapshot stamps the time it was read, so its text differs on every read. When the committed file
  // already holds these rows and this audit max, it is in step with production: keep its text, so `records`
  // can answer "matches" and opens no PR that changes nothing but a timestamp.
  const stateFileText = sameSwitchRows(currentStateText, snapshot)
    ? currentStateText
    : formatSwitchStateSnapshot(snapshot);
  const docChanges = [];
  const unresolved = [];
  for (const d of findAuthorityDocStateDrift({ snapshot, docs })) {
    const row = snapshot.rows?.[d.option] ?? null;
    if (d.liveState === 'default' && releaseDefaultOn.has(d.option)) {
      unresolved.push({
        option: d.option,
        reason: `no switch row and release default ON; the doc says ${d.docState}`,
      });
      continue;
    }
    const text = rewriteAuthorityDocState(docs[d.option], d.liveState, row);
    const reparsed = text === null ? null : parseAuthorityDocState(text);
    const wanted = d.liveState === 'default' ? 'off' : d.liveState;
    if (!reparsed || reparsed.state !== wanted) {
      unresolved.push({
        option: d.option,
        reason: 'its State token could not be rewritten safely',
      });
      continue;
    }
    docChanges.push({
      option: d.option,
      path: `${AUTHORITY_DOC_DIR}/${d.option}.md`,
      text,
      from: d.docStateText,
      to: reparsed.raw,
    });
  }
  for (const u of findUnjudgedLiveAuthorityDocs({ snapshot, docs })) {
    if (docsWithoutStateAllowed.includes(u.option)) continue;
    const row = snapshot.rows?.[u.option] ?? null;
    const text =
      u.docStateText === null ? insertAuthorityDocState(docs[u.option], u.liveState, row) : null;
    const reparsed = text === null ? null : parseAuthorityDocState(text);
    if (!reparsed || reparsed.state !== u.liveState) {
      unresolved.push({
        option: u.option,
        reason:
          u.docStateText === null
            ? `live ${u.liveState}, and its doc has no State token; one could not be added safely`
            : `live ${u.liveState}, and its doc State "${u.docStateText}" cannot be read`,
      });
      continue;
    }
    docChanges.push({
      option: u.option,
      path: `${AUTHORITY_DOC_DIR}/${u.option}.md`,
      text,
      from: '(no State token)',
      to: reparsed.raw,
    });
  }
  return {
    stateFileText,
    stateFileChanged: stateFileText !== currentStateText,
    docChanges,
    unresolved,
  };
}

/** Pure. Title and body of the records PR. */
export function formatRecordsPr({ change, snapshot, trigger }) {
  const lines = [
    `Records only: brings \`${SWITCH_STATE_FILE}\` and the authority docs in step with the live switch rows`,
    `(${Object.keys(snapshot.rows ?? {}).length} rows, audit max ${snapshot.auditMax ?? '?'}, read ${snapshot.asOfUtc}).`,
    '',
    trigger ? `Trigger: ${trigger}.` : 'Trigger: `horse-option-switch.mjs records`.',
    '',
    change.stateFileChanged
      ? `- \`${SWITCH_STATE_FILE}\` rewritten from the live rows.`
      : `- \`${SWITCH_STATE_FILE}\` already matched the live rows.`,
    ...change.docChanges.map((c) => `- \`${c.path}\`: State "${c.from}" -> "${c.to}"`),
    ...change.unresolved.map((u) => `- NOT CHANGED, needs a person: ${u.option} (${u.reason})`),
    '',
    'Generated by scripts/ops/horse-option-switch.mjs from a read-only query. No switch, settings or database write.',
  ];
  const opts = change.docChanges.map((c) => c.option);
  const title =
    opts.length > 0
      ? `docs(horses): record the live switch state of ${opts.slice(0, 3).join(', ')}${opts.length > 3 ? ` and ${opts.length - 3} more` : ''}`
      : `docs(horses): record the live switch rows (audit max ${snapshot.auditMax ?? '?'})`;
  return { title, body: lines.join('\n') };
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
}

/**
 * The side effects, injected into the CLI so tests never touch git or the network. Builds the change
 * inside a fresh worktree of origin/main (so it judges main, not the operator's branch), commits, pushes
 * through scripts/agent-push.sh and opens the PR. Returns { prUrl, branch, change } or { noChange }.
 */
export function defaultOpenRecordsPr({
  repoRoot,
  snapshot,
  releaseDefaultOn,
  trigger,
  root = process.env.CA_RECORDS_ROOT || tmpdir(),
  log = () => {},
}) {
  run('git', ['-C', repoRoot, 'fetch', '-q', 'origin', 'main'], { timeout: 120_000 });
  const stamp = String(snapshot.asOfUtc || new Date().toISOString())
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const branch = `agent/horse-switch-records/${stamp}-audit-${snapshot.auditMax ?? 'x'}`;
  const dir = mkdtempSync(join(root, 'horse-switch-records-'));
  const tree = join(dir, 'wt');
  run('git', ['-C', repoRoot, 'worktree', 'add', '-q', '-b', branch, tree, 'origin/main'], {
    timeout: 600_000,
  });
  let keepTree = false;
  try {
    const docs = {};
    for (const f of readdirSync(join(tree, AUTHORITY_DOC_DIR))) {
      if (!f.endsWith('.md')) continue;
      const name = f.slice(0, -3);
      if (name.includes('.')) continue;
      docs[name] = readFileSync(join(tree, AUTHORITY_DOC_DIR, f), 'utf8');
    }
    const statePath = join(tree, SWITCH_STATE_FILE);
    const currentStateText = existsSync(statePath) ? readFileSync(statePath, 'utf8') : '';
    const change = buildRecordsChange({ snapshot, docs, currentStateText, releaseDefaultOn });
    if (!change.stateFileChanged && change.docChanges.length === 0) {
      return { noChange: true, change };
    }
    writeFileSync(statePath, change.stateFileText, 'utf8');
    for (const c of change.docChanges) writeFileSync(join(tree, c.path), c.text, 'utf8');
    const { title, body } = formatRecordsPr({ change, snapshot, trigger });
    // The pre-push hook runs node tools: borrow the operator checkout's installed modules.
    for (const nm of ['node_modules', 'server/node_modules']) {
      const from = join(repoRoot, nm);
      if (existsSync(from) && !existsSync(join(tree, nm))) symlinkSync(from, join(tree, nm), 'dir');
    }
    run('git', ['-C', tree, 'add', SWITCH_STATE_FILE, ...change.docChanges.map((c) => c.path)]);
    run('git', ['-C', tree, 'commit', '-q', '--no-verify', '-m', `${title}\n\n${body}\n`]);
    log(`records: pushing ${branch}`);
    keepTree = true;
    run('bash', ['scripts/agent-push.sh'], { cwd: tree, timeout: 3_600_000, stdio: 'inherit' });
    const prUrl = run(
      'gh',
      ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body],
      { cwd: tree, timeout: 120_000 }
    )
      .trim()
      .split('\n')
      .pop();
    keepTree = false;
    return { prUrl, branch, change };
  } finally {
    if (!keepTree) {
      try {
        run('git', ['-C', repoRoot, 'worktree', 'remove', '--force', tree], { timeout: 600_000 });
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // The tree is reported below by the caller's finishing command; a stale temp folder is harmless.
      }
    }
  }
}
