# A worktree path with a space no longer breaks the push, and release laws stop measuring the host

## File URLs are decoded before they are used as paths

The work drive remounted as `/Volumes/SmarterWork 1`, and every push from a
worktree on it died in the pre-push hook: `scandir '/Volumes/SmarterWork%201/.../src'`.
Scripts took `new URL(..., import.meta.url).pathname`, which is the encoded URL
path, as a filesystem path. Some checks failed loudly; worse, `check-ui-dollar`
scanned 0 files and passed, and `check-title-case` decided it was not the main
module and exited 0 without checking anything. The same blindness was in every
hand-built `file://` URL compared with `import.meta.url` to detect the main module.

Every such site (about 60 files across scripts/, server/scripts/, tests/, server
tests and operations fixtures) now uses `fileURLToPath(...)` or
`pathToFileURL(path).href`. `tests/a-file-url-is-decoded-before-it-is-a-path.law.test.ts`
sweeps every tracked script and test for the hand-rolled forms so they cannot
return. The hook's own bash already quotes every path that can contain the
worktree root.

## Release law tests assert behaviour, not spare CPU

At load 30-69 on the shared Mac, correct code failed release laws in the hook:

- `the-replacement-is-created-during-the-outgoing-grace`: overlap of stop and
  create was proved by wall time (`< 3.5 s`). The fake Docker is now a
  rendezvous - neither returns until the other has begun - so a serialized
  engine-up is caught by causality, and load cannot fail a correct one.
- `a-waiting-release-withdrawal-keeps-its-original-owner`: two cases read the
  fixture's promise with the real clock after slow git setup, exceeding the
  10 s freshness window. They now read it on the fixture's clock.
- `engine-release-seal`, `an-engine-activation-floor-precedes-runtime-writes`,
  `lightning-is-held-for-the-engine-cutover`, `the-deploy-can-always-ship`:
  subprocess and test timeouts that exist only as hang guards are now sized as
  hang guards (and each child guard stays below its test's budget). The
  assertions on exit status and output are unchanged.

No production deadline, budget or freshness window changed; the production
scripts touched only swap the hand-rolled URL conversions for the standard ones.
The one reviewed exception is an `[eval1]` suffix check in
`server/scripts/legacy-engine-checkpoint.mjs` (an engine release asset that never
uses the URL as a path), pinned by exact text in the law.
