#!/usr/bin/env node
// ONE WAY TO POST TO THE COORDINATION INBOX, with one deterministic fallback.
//
//   node scripts/ops/coordination-inbox-post.mjs --from "<lane (session)>" --to "<lanes>" --subject "<...>" --body-file <file> [--dry-run]
//   node scripts/ops/coordination-inbox-post.mjs targets
//
// The canonical inbox is the SSD2 file; the SSD1 file is its mirror. A post goes to the canonical file and,
// when SSD1 is mounted, to the mirror. When SSD1 is not mounted the post still lands in the canonical file,
// which is the one to read after any outage. When SSD2 is not mounted the post is REFUSED (exit 3) unless
// --mirror-only is given, in which case it lands in the mirror alone and says so. A folder on the boot disk
// that merely carries a drive's name is never written: on 2026-11-22 that is where a post would have gone.
// The body must be pure ASCII; the post ends with GATE END.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatInboxPost, inboxTargets } from './drive-loss-lib.mjs';
import { fsDriveProbe } from './fs-drive-probe.mjs';

export function runInboxPost(argv, deps) {
  const flags = {};
  const bare = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--mirror-only') flags[a.slice(2)] = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[(i += 1)];
    else bare.push(a);
  }
  const { targets, skipped, canonicalReachable } = inboxTargets(deps.probe);
  for (const s of skipped) deps.stderr(`[inbox] ${s.role} not written (${s.why}): ${s.path}`);
  if (bare[0] === 'targets') {
    for (const t of targets) deps.stdout(`${t.role}\t${t.path}`);
    return targets.length > 0 ? 0 : 3;
  }
  if (targets.length === 0 || (!canonicalReachable && !flags['mirror-only'])) {
    deps.stderr(
      '[inbox] REFUSED: the canonical inbox drive (SSD2) is not mounted. Nothing was written. ' +
        'Pass --mirror-only to post to the SSD1 mirror alone; re-post to the canonical file when SSD2 is back.'
    );
    return 3;
  }
  const text = formatInboxPost({
    from: flags.from,
    to: flags.to,
    subject: flags.subject,
    body: deps.readFile(flags['body-file']),
    nowIso: deps
      .now()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
  });
  for (const t of targets) {
    if (!flags['dry-run']) deps.append(t.path, text);
    deps.stdout(`[inbox] ${flags['dry-run'] ? 'would post' : 'posted'} to ${t.role}: ${t.path}`);
  }
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    process.exitCode = runInboxPost(process.argv.slice(2), {
      probe: fsDriveProbe(),
      readFile: (f) => readFileSync(f, 'utf8'),
      append: (f, s) => appendFileSync(f, s),
      now: () => new Date(),
      stdout: (s) => console.log(s),
      stderr: (s) => console.error(s),
    });
  } catch (err) {
    console.error(`[inbox] ${err.message}`);
    process.exitCode = 2;
  }
}
