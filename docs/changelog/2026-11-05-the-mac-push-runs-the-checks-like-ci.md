# The Mac Push Runs The Checks The Way CI Does

On 2026-11-05 every server push from the Mac Studio was refused by tests that pass in CI and also failed on an untouched `origin/main` checkout, so an engine change could not be pushed from this machine at all. The causes were all environment:

- Homebrew's `node` on the Mac is Node 26 (nvm also holds 20, 22 and 24); CI and the engine run Node 22. Node 26 prints a `module.register()` deprecation warning that tests asserting a silent stderr read as a failure.
- macOS points `TMPDIR` at `/var/folders` on the boot drive. The Phase 14 fleet tests refuse anything but an owned external-SSD scratch directory, and a long `TMPDIR` makes PostgreSQL's Unix socket name too long for the money fixtures (and broke one activation-floor case).
- The native evaluator `server/native/build/public_hist215_wtl.node` is a build product (CI builds it in `pretest`), so a fresh worktree has none.

`.husky/pre-push` now, on macOS only, runs the checks on nvm's newest Node 22 when the shell's node is another major, gives each run its own short `TMPDIR` under `/Volumes/SmarterWork/agent-work/.t` (runs older than a day are pruned; a `TMPDIR` already on `/Volumes` is kept), and builds the native evaluator before the server tests when a worktree has none. With those three, the seven server test files and the activation-floor case that failed on the Mac pass there. Law: `tests/the-mac-push-runs-the-checks-like-ci.law.test.ts`.
