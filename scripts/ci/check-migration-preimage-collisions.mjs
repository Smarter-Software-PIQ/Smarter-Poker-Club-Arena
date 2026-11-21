#!/usr/bin/env node
/**
 * Guardrail #5: Pre-merge pre-image MD5 freshness check.
 *
 * Migrations frequently pin the expected `md5(pg_get_functiondef(...))` pre-image
 * of a PostgreSQL function before patching or replacing it. When two migrations
 * touch the same function and the later migration still pins an older pre-image
 * MD5 `X` even though an earlier/concurrent migration already rewrites that
 * exact function to post-image MD5 `Y` (`Y != X`), the later migration is
 * guaranteed to fail with "pre-image drifted" at install time.
 *
 * This static analyzer walks `supabase/migrations/` in chronological order,
 * tracks each migration's declared post-image MD5s (`VALUES (sig, pre, post, ...)`,
 * `DO $post$` assertions, and `-- @live-proof:` MD5 assertions), and checks
 * every migration with timestamp >= 20261120000000: if a migration pins a
 * function `schema.fn(args)` to expected pre-image `X` while an earlier
 * migration already produces post-image `Y != X` (and the later migration does
 * not accept `Y`), it fails BEFORE merge with both filenames and hashes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PREIMAGE_COLLISION_CHECKED_FROM = '20261120000000';

const MIGRATION_VERSION_RE = /(?:^|\/)(\d{14})_[^/]+\.sql$/;

export function migrationVersion(file) {
  const m = MIGRATION_VERSION_RE.exec(String(file).replace(/\\/g, '/'));
  return m ? m[1] : null;
}

export function isPreimageCollisionChecked(file) {
  const version = migrationVersion(file);
  return version !== null && version >= PREIMAGE_COLLISION_CHECKED_FROM;
}

/**
 * Normalize a PostgreSQL function signature for exact comparison across
 * `regprocedure` / `to_regprocedure` spellings.
 */
export function normalizeSignature(sig) {
  const cleaned = String(sig).trim().toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ');

  const openIdx = cleaned.indexOf('(');
  const closeIdx = cleaned.lastIndexOf(')');
  if (openIdx < 0 || closeIdx < openIdx) return cleaned;

  let name = cleaned.slice(0, openIdx).replace(/\s+/g, '');
  if (!name.includes('.')) name = `public.${name}`;

  const rawArgs = cleaned.slice(openIdx + 1, closeIdx).trim();
  if (!rawArgs) return `${name}()`;

  const normArgs = rawArgs
    .split(',')
    .map((arg) =>
      arg
        .trim()
        .replace(/\btimestamptz\b/g, 'timestamp with time zone')
        .replace(/\bint4\b/g, 'integer')
        .replace(/\bint8\b/g, 'bigint')
        .replace(/\bint2\b/g, 'smallint')
        .replace(/\bbool\b/g, 'boolean')
        .replace(/\bfloat8\b/g, 'double precision')
        .replace(/\bvarchar\b/g, 'character varying')
        .replace(/\s+/g, ' ')
    )
    .join(',');

  return `${name}(${normArgs})`;
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Strip SQL comments while preserving newlines so character offsets map 1:1
 * to 1-based line numbers in the original SQL.
 */
function stripCommentsPreservingLines(sql) {
  const src = String(sql);
  const chars = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    if (src[i] === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') {
        chars[i] = ' ';
        i += 1;
      }
      if (i < src.length) {
        chars[i] = '\n';
        i += 1;
      }
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      let depth = 1;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth += 1;
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth -= 1;
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
        } else {
          chars[i] = src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
      }
      continue;
    }
    chars[i] = src[i];
    i += 1;
  }
  return chars.join('');
}

function isPostImageAssertionContext(code, matchOffset, matchLength, normalizedSig) {
  const before = code.slice(Math.max(0, matchOffset - 600), matchOffset);
  const after = code.slice(matchOffset + matchLength, matchOffset + matchLength + 400);

  // Check enclosing DO $post...$ tag
  const doTags = [...before.matchAll(/\bdo\s+\$([A-Za-z0-9_]*)\$/gi)];
  const lastDoTag = doTags.length > 0 ? doTags[doTags.length - 1][1] : '';
  if (/post/i.test(lastDoTag)) return true;

  // Check immediate RAISE EXCEPTION message for post-image wording
  const raiseMatch = /\braise\s+exception\s+'([^']*)'/i.exec(after);
  if (raiseMatch && /post[-_ ]?image/i.test(raiseMatch[1])) return true;

  // Check if CREATE OR REPLACE FUNCTION for this exact function name appeared earlier
  const fnName = normalizedSig.slice(0, normalizedSig.indexOf('('));
  const escapedName = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const earlierCreateRe = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\(`,
    'i'
  );
  if (earlierCreateRe.test(code.slice(0, matchOffset))) return true;

  return false;
}

/**
 * Extract declared pre-image MD5 pins and post-image MD5 outputs from a
 * single SQL migration.
 */
export function extractMigrationMd5Pins(sql) {
  const src = String(sql);
  if (!/[0-9a-f]{32}/i.test(src)) {
    return { preImages: [], postImages: [] };
  }
  const code = stripCommentsPreservingLines(src);
  const preImages = [];
  const postImages = [];

  // 1. Anchored substitution VALUES tuples:
  //    ('schema.fn(args)', '<pre_md5>', '<post_md5>', ...)
  const tupleRe =
    /\(\s*'([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\([^')]*\))'\s*,\s*'([0-9a-f]{32})'\s*,\s*'([0-9a-f]{32})'\s*,/gi;
  let m;
  while ((m = tupleRe.exec(code)) !== null) {
    const sig = m[1];
    const normalizedSig = normalizeSignature(sig);
    const preMd5 = m[2].toLowerCase();
    const postMd5 = m[3].toLowerCase();
    const line = lineNumberAt(src, m.index);

    preImages.push({
      sig,
      normalizedSig,
      md5: preMd5,
      acceptedMd5s: [preMd5],
      line,
      kind: 'values-tuple',
    });
    postImages.push({
      sig,
      normalizedSig,
      md5: postMd5,
      line,
      kind: 'values-tuple',
    });
  }

  // 2. Direct md5(pg_get_functiondef(...)) comparisons:
  //    md5(pg_get_functiondef('schema.fn(args)'::regprocedure)) IS DISTINCT FROM '<md5>'
  //    md5(pg_get_functiondef(to_regprocedure('schema.fn(args)'))) <> '<md5>'
  //    md5(pg_get_functiondef(...)) NOT IN ('<md5a>', '<md5b>')
  const directRe =
    /\bmd5\s*\(\s*(?:pg_catalog\s*\.\s*)?pg_get_functiondef\s*\(\s*(?:(?:pg_catalog\s*\.\s*)?to_regprocedure\s*\(\s*'([^']+)'\s*\)|'([^']+)'\s*::\s*(?:pg_catalog\s*\.\s*)?regprocedure)\s*\)\s*\)\s*(?:(is\s+distinct\s+from|<>|!=)\s*'([0-9a-f]{32})'|not\s+in\s*\(([^)]+)\))/gi;
  while ((m = directRe.exec(code)) !== null) {
    const sig = m[1] || m[2];
    if (!sig || !sig.includes('(')) continue;
    const normalizedSig = normalizeSignature(sig);
    const line = lineNumberAt(src, m.index);

    let hashes = [];
    if (m[4]) {
      hashes = [m[4].toLowerCase()];
    } else if (m[5]) {
      hashes = [...m[5].matchAll(/'([0-9a-f]{32})'/gi)].map((h) => h[1].toLowerCase());
    }
    if (hashes.length === 0) continue;

    if (isPostImageAssertionContext(code, m.index, m[0].length, normalizedSig)) {
      if (hashes.length === 1) {
        postImages.push({
          sig,
          normalizedSig,
          md5: hashes[0],
          line,
          kind: 'post-assertion',
        });
      }
    } else {
      preImages.push({
        sig,
        normalizedSig,
        md5: hashes[0],
        acceptedMd5s: hashes,
        line,
        kind: 'direct-pin',
      });
    }
  }

  // 3. `-- @live-proof:` comment post-image MD5 assertions:
  //    -- @live-proof: ... md5(pg_get_functiondef('schema.fn(args)'::regprocedure)) = '<md5>'
  const lines = src.split('\n');
  const liveProofRe =
    /\bmd5\s*\(\s*(?:pg_catalog\s*\.\s*)?pg_get_functiondef\s*\(\s*(?:(?:pg_catalog\s*\.\s*)?to_regprocedure\s*\(\s*'([^']+)'\s*\)|'([^']+)'\s*::\s*(?:pg_catalog\s*\.\s*)?regprocedure)\s*\)\s*\)\s*=\s*'([0-9a-f]{32})'/gi;
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (!/^\s*--\s*@live-proof:/i.test(lines[idx])) continue;
    let lpMatch;
    liveProofRe.lastIndex = 0;
    while ((lpMatch = liveProofRe.exec(lines[idx])) !== null) {
      const sig = lpMatch[1] || lpMatch[2];
      if (!sig || !sig.includes('(')) continue;
      const normalizedSig = normalizeSignature(sig);
      postImages.push({
        sig,
        normalizedSig,
        md5: lpMatch[3].toLowerCase(),
        line: idx + 1,
        kind: 'live-proof',
      });
    }
  }

  return { preImages, postImages };
}

/**
 * Analyze an ordered list of `{ file, sql }` migrations for pre-image MD5
 * collisions. Only migrations matching `isPreimageCollisionChecked(file)`
 * (timestamp >= 20261120000000) are flagged, while earlier migrations still
 * contribute their post-image MD5s to the function state table.
 */
export function findPreimageCollisions(migrations) {
  const ordered = [...migrations].sort((a, b) => a.file.localeCompare(b.file));
  const latestPostBySig = new Map();
  const collisions = [];

  for (const migration of ordered) {
    const { preImages, postImages } = extractMigrationMd5Pins(migration.sql);

    if (isPreimageCollisionChecked(migration.file)) {
      // Collect all accepted pre-image MD5s per normalized signature in this migration.
      const acceptedBySig = new Map();
      for (const pre of preImages) {
        if (!acceptedBySig.has(pre.normalizedSig)) {
          acceptedBySig.set(pre.normalizedSig, new Set());
        }
        const set = acceptedBySig.get(pre.normalizedSig);
        for (const h of pre.acceptedMd5s) set.add(h);
      }

      const reportedForFileSig = new Set();
      for (const pre of preImages) {
        const latest = latestPostBySig.get(pre.normalizedSig);
        if (!latest) continue;

        const accepted = acceptedBySig.get(pre.normalizedSig);
        if (accepted && accepted.has(latest.md5)) continue;

        const dedupeKey = `${pre.normalizedSig}::${pre.md5}::${latest.md5}`;
        if (reportedForFileSig.has(dedupeKey)) continue;
        reportedForFileSig.add(dedupeKey);

        collisions.push({
          file: migration.file,
          line: pre.line,
          signature: pre.sig,
          normalizedSignature: pre.normalizedSig,
          expectedPreMd5: pre.md5,
          acceptedPreMd5s: [...(accepted ?? [pre.md5])],
          earlierFile: latest.file,
          earlierLine: latest.line,
          earlierPostMd5: latest.md5,
        });
      }
    }

    // Advance the known post-image state after checking this migration's pre-images.
    for (const post of postImages) {
      latestPostBySig.set(post.normalizedSig, {
        md5: post.md5,
        file: migration.file,
        line: post.line,
        sig: post.sig,
      });
    }
  }

  return collisions;
}

function bareFunctionName(normalizedSig) {
  const openIdx = normalizedSig.indexOf('(');
  const full = openIdx >= 0 ? normalizedSig.slice(0, openIdx) : normalizedSig;
  const dotIdx = full.lastIndexOf('.');
  return dotIdx >= 0 ? full.slice(dotIdx + 1) : full;
}

function candidateHistoricalFilesViaGit(migrationsDir, fnNames) {
  if (fnNames.length === 0) return [];
  const args = ['grep', '-l', '-i', '-F', '--cached'];
  for (const name of fnNames) {
    args.push('-e', name);
  }
  args.push('--', '.');
  try {
    const out = execFileSync('git', args, {
      cwd: migrationsDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.sql'))
      .map((line) => basename(line));
  } catch (err) {
    if (err && typeof err === 'object' && err.status === 1) return [];
    return null;
  }
}

/**
 * Scan all SQL migrations in a directory and report pre-image collisions for
 * migrations >= PREIMAGE_COLLISION_CHECKED_FROM.
 */
export function checkMigrationsDir(migrationsDir) {
  if (!existsSync(migrationsDir)) {
    return { totalCount: 0, checkedCount: 0, collisions: [] };
  }
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const checkedNames = [];
  const earlierNames = [];
  for (const name of files) {
    if (isPreimageCollisionChecked(name)) checkedNames.push(name);
    else earlierNames.push(name);
  }

  // Always read all checked migrations (>= 20261120000000) directly from disk.
  const checkedMigrations = checkedNames.map((name) => ({
    file: `supabase/migrations/${name}`,
    sql: readFileSync(join(migrationsDir, name), 'utf8'),
  }));

  const pinnedFnNames = new Set();
  for (const m of checkedMigrations) {
    const { preImages } = extractMigrationMd5Pins(m.sql);
    for (const pre of preImages) {
      const fnName = bareFunctionName(pre.normalizedSig);
      if (fnName) pinnedFnNames.add(fnName);
    }
  }

  if (pinnedFnNames.size === 0) {
    return { totalCount: files.length, checkedCount: checkedNames.length, collisions: [] };
  }

  let relevantEarlierNames = earlierNames;
  if (earlierNames.length > 200) {
    const gitCandidates = candidateHistoricalFilesViaGit(migrationsDir, [...pinnedFnNames]);
    if (gitCandidates !== null) {
      const earlierSet = new Set(earlierNames);
      relevantEarlierNames = gitCandidates.filter((name) => earlierSet.has(name)).sort();
    }
  }

  const earlierMigrations = relevantEarlierNames.map((name) => ({
    file: `supabase/migrations/${name}`,
    sql: readFileSync(join(migrationsDir, name), 'utf8'),
  }));

  const collisions = findPreimageCollisions([...earlierMigrations, ...checkedMigrations]);
  return { totalCount: files.length, checkedCount: checkedNames.length, collisions };
}

function main() {
  const dirArg = process.argv[2] || join(process.cwd(), 'supabase', 'migrations');
  const { totalCount, checkedCount, collisions } = checkMigrationsDir(dirArg);

  if (collisions.length > 0) {
    console.error(
      `[check-migration-preimage-collisions] FAIL: ${collisions.length} pre-image MD5 collision(s) detected:`
    );
    for (const c of collisions) {
      console.error(`  ${c.file}:${c.line} pins ${c.signature} to pre-image ${c.expectedPreMd5}`);
      console.error(
        `    but earlier migration ${c.earlierFile}:${c.earlierLine} already produces post-image ${c.earlierPostMd5}`
      );
    }
    console.error(
      '\nRebase this migration on top of the earlier migration and pin its post-image MD5 instead.'
    );
    process.exit(1);
  }

  console.log(
    `[check-migration-preimage-collisions] OK: ${checkedCount} migration(s) >= ${PREIMAGE_COLLISION_CHECKED_FROM} checked against ${totalCount} total migrations (${basename(dirArg)}).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
