// MERGE QUEUE (2026-11-11): which migration files a queued merge-group commit
// changes, read from a GitHub compare against the group's FIXED base (the
// merge base recorded in the trusted proof), never against a moving main. The
// producer and the finishing reporter share this one classification, so the
// set proven at the start is the set re-read at the finish.
//   content: added / modified / renamed / copied / changed migration files,
//            whose bytes are verified;
//   removed: migration paths the commit deletes (or renames away), bound to
//            the set by path so a later change of them is still a mismatch.
// Any other status on a migration path is refused: fail closed.
export const MIGRATION = /^supabase\/migrations\/[^/]+\.sql$/;
const CONTENT = new Set(['added', 'modified', 'renamed', 'copied', 'changed']);

export function mergeGroupMigrationFiles(files) {
  if (!Array.isArray(files) || files.length >= 300) throw Error('diff truncated');
  const content = new Set();
  const removed = new Set();
  for (const f of files) {
    const name = typeof f?.filename === 'string' ? f.filename : '';
    const previous = typeof f?.previous_filename === 'string' ? f.previous_filename : '';
    if (!MIGRATION.test(name) && !MIGRATION.test(previous)) continue;
    if (CONTENT.has(f.status)) {
      if (MIGRATION.test(name)) content.add(name);
      if (MIGRATION.test(previous) && previous !== name) removed.add(previous);
    } else if (f.status === 'removed') {
      removed.add(name);
    } else {
      throw Error(`unsupported migration file status ${String(f?.status)}`);
    }
  }
  for (const p of content) removed.delete(p);
  return { content: [...content].sort(), removed: [...removed].sort() };
}

/** A compare from the fixed base: the head must still be strictly ahead of it. */
export function fixedBaseMigrationFiles(cmp) {
  if (cmp?.status !== 'ahead' || cmp.behind_by !== 0) throw Error('merge group is not ahead of its base');
  return mergeGroupMigrationFiles(cmp.files);
}
