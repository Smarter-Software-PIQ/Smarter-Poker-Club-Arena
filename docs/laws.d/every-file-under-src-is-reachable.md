# tests/every-file-under-src-is-reachable.law.test.ts

Walks from index.html -> src/main.tsx (static and dynamic imports, re-exports,
CSS @import, the vite aliases) and fails on any file under src/ the walk does
not reach unless it is listed in the test with the reader that still names it
by path; the list has no ghosts and never lists a reachable file, so it only
shrinks. Written after audit CL-55: 73 dead barrels hid a 130-component
design-system layer from the direct-import orphan ratchet.

A path that `vite.config.ts` names counts as an entry only when it is a file:
an alias target such as `./src/lib` is a directory, and until 2026-11-27 it
rooted that directory's index barrel, which hid four unimported barrels and the
two modules (`src/lib/api.ts`, `src/lib/validation.ts`) behind one of them.
