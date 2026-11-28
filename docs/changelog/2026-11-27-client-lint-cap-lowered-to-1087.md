# Client lint cap lowered to 1087

#12279 failed "Client lint has no errors and no new warnings" with 1091
warnings against the 1089 cap. Its own change was CSS and a test; the extra
warnings came from the Club Operations redesign on main
(`ClubPageSection.tsx`, `ClubOperationsPage.tsx`). #12278 (72bd27d34) fixed
them at source minutes later, and `eslint src/` on main (b5f712d6e) now
reports 0 errors and 1087 warnings.

Following the ratchet's own rule ("when a change brings it down, lower
MAX_WARNINGS to the new count"), `client-lint-ratchet.yml` now caps at 1087
so the two fixed warnings cannot come back.
