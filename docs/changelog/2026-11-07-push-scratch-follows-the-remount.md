# The Push Scratch Folder Follows The Remount

On 2026-11-07 at about 03:02 CT the Mac's SmarterWork drive was remounted. `agent-work/` became root-owned and the SanDisk volume was nested at `agent-work/extreme-capacity/`. The pre-push hook's default scratch root `/Volumes/SmarterWork/agent-work/.t` could no longer be created, so every agent's push failed until it set `CA_PUSH_TMP_ROOT` by hand.

With no override, `.husky/pre-push` now takes the first external candidate it can create: the old path, then `agent-work/extreme-capacity/.t`. An explicit `CA_PUSH_TMP_ROOT` is used exactly as before. The external-device check that follows (which refuses a scratch directory on the boot drive) is unchanged, so this can never fall back to internal storage.
