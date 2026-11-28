# Arena Workspace Titles Use The Shipped Condensed Face (2026-11-27)

## What was wrong

The arena workspace titles and controls (`.arena-section-title`, the
`members-console__heading`, the `arena-switch` buttons, the roster readouts and
ledger rows in `src/components/club/RosterRecords.css`, the cashier wallet
figure) asked for `'Arial Narrow'` first, then `Arial`. Macs and Windows have
Arial Narrow. Android and Linux do not, so a phone fell back to wide Arial: the
same Player Management page read narrow on a Mac and wide on a phone.

## What changed

- Every font stack in `src/components/lobby/ArenaWorkspace.css` and
  `src/components/club/RosterRecords.css` that names `'Arial Narrow'` now names
  `'Roboto Condensed'` ahead of it (15 stacks). Roboto Condensed is the
  condensed face the app already ships: `index.html` names it in the Google
  Fonts link, and `scripts/self-host-fonts.mjs` downloads it at build time into
  `dist/fonts/` and rewrites the shell to `/hub/club-arena/fonts/fonts-<hash>.css`,
  so production serves the woff2 from our own origin. No third-party font host
  is added at runtime.
- `scripts/prerender-public-routes.mjs` adds `'Roboto Condensed'` to
  `PRERENDER_FONT_FAMILIES`. `dist/index.html` is the shell for every route and
  already inlines the self-hosted stylesheet; now it also preloads Roboto
  Condensed's one latin file (a variable face covering every declared weight),
  so the narrow face is in hand before a workspace paints and titles do not
  swap widths.

## Proof

- Render at 393px with Arial Narrow removed from fontconfig (the Android
  case): before, "Roster Export" and "Change History" are wide Arial; after,
  narrow Roboto Condensed. Sheet: `/home/claude/renders/arena-titles-roster-393.jpg`.
- `tests/unit/arenaTitlesUseTheShippedCondensedFace.test.ts` pins every stack
  and the preload; `tests/the-public-arena-is-readable-without-javascript.law.test.ts`
  now expects the Roboto Condensed latin preload and no preload for its other
  subsets.
