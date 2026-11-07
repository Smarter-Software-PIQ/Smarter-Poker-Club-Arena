# A window migration names the lock it needs

2026-11-07. Follows the same morning's
[a refused window migration no longer holds the queue](2026-11-07-a-refused-window-migration-no-longer-holds-the-queue-and-a-superseded-backup-run-steps-aside.md).

## Why

Since this morning the 04:00 America/Chicago installer
(`scripts/ci/install-window-migrations.mjs`) skips a refused
`-- @install-window: daily-maintenance` file alone and keeps sending the queue
behind it. That makes the SEND ORDER matter: one lost 1 s `lock_timeout` on
`public.clubs` should cost the files that need `public.clubs`, not an
unrelated file that happened to be queued behind it, and the red run should
say which relation was lost instead of leaving the reader to infer it from
`55P03: canceling statement due to lock timeout`, which names nothing.

## What

1. **A new optional header line.** A window migration may declare the hot
   relations its writer-blocking lock needs, on one line of its own:

   ```
   -- @locks: public.clubs, public.tables
   ```

   Schema-qualified, comma separated, relations only. `windowLocks()` in
   `scripts/ci/maintenance-window-migrations.mjs` parses it and
   `validateWindowMigration()` calls it, so an unparseable value
   (`-- @locks: nonsense`) is a static `REFUSED before waiting`, sent nowhere,
   like every other header rule. Undeclared is allowed: the file is treated as
   independent and its order among other undeclared files is unchanged.

2. **The installer orders the queue** (`orderWindowQueue()`): files declaring
   nothing first, oldest version first; then files declaring locks, grouped so
   that files sharing a relation (transitively) are adjacent, groups by their
   oldest member, oldest first inside a group. The order is printed as a
   `send order:` line whenever any file declares locks.

3. **A skipped file names the relation it lost.** The installer now captures
   the applier's stderr (`stdio: ['ignore', 'inherit', 'pipe']`) and re-emits
   it unchanged, then reads the refusal: a NOWAIT refusal
   (`could not obtain lock on relation "..."`) names the relation outright;
   a `lock_timeout` refusal (55P03) names the declared relation a live
   transaction still held at the refusal (the holder read that already
   existed), or every declared relation when nothing singles one out. The
   `SKIPPED` line ends `Lost its lock on public.clubs.` and the verdict reads
   ``REFUSED 1 of 3 ... `file` (lost public.clubs); installed 2: ...``.
   A refusal that names no relation prints exactly as before.

4. **Nothing else moves.** The declaration never reaches the applier, never
   widens `lock_timeout` or `statement_timeout`, never earns a retry and never
   changes the transaction sent. The quiet-moment wait still reads the file's
   SQL, not the declaration. A refused file is still skipped alone and an
   UNKNOWN outcome still stops the run.

## Proof

- `scripts/ci/test-maintenance-window-migrations.sh` section 12 (ALL PASS on
  PostgreSQL 16 locally; PostgreSQL 17 in `maintenance-window-migrations.yml`):
  A (no `@locks`, newest version), B (`@locks: public.clubs`, `public.clubs`
  held past the bounded wait) and C (`@locks: public.hand_history`) are sent
  A, B, C; B is `SKIPPED ... Lost its lock on public.clubs.`, A and C are
  `INSTALLED` with exact history, the verdict names `(lost public.clubs)`, exit
  1, history holds exactly A and C, B's column is absent. A file with
  `-- @locks: nonsense` is `REFUSED before waiting` and nothing is sent.
- `tests/a-window-migration-waits-for-the-daily-break.law.test.ts` pins the
  parser, the ordering, the lost-relation naming, the stderr capture, that the
  declaration never reaches the applier or any timeout, and every earlier pin
  (skip alone, verdict naming skipped files, UNKNOWN stop).
- `docs/laws.d/a-window-migration-waits-for-the-daily-break.md`, CLAUDE.md
  section 2 rule 10 and the skeleton written by `scripts/new-migration.mjs`
  describe the line.
