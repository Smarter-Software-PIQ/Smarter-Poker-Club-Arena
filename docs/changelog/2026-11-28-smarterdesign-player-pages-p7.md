# 2026-11-28 — #SmarterDesign Batch P7: Public Profile, Report Player, Invite Code, and Not Found

## Summary

Converted four player-facing routes onto the `#SmarterDesign` arena workspace language (`ArenaWorkspace.css` + `ArenaOps.css`):

- **Public Profile (`/profile/:userId`)**: `src/pages/PublicProfilePage.tsx`, `src/pages/PublicProfilePage.module.css` — matches `ProfilePage`'s chrome mast (`ArenaWorkspaceHeader`), thin chrome credential case (`arena-case`), four `arena-meter` record tiles, chrome-stat `arena-switch` action rail (primary lit; Report kept reachable while blocked), and Mutual Friends / QR `arena-case` sections while keeping every `className` module-composed (`tests/unit/profileCredential.test.ts`).
- **Report Player (`/report/:playerId`)**: `src/pages/ReportPlayerPage.tsx`, `src/pages/ReportPlayerPage.css` — removed both `SpadeConsole` wrappers in favor of `arena-workspace`, `ArenaWorkspaceHeader`, `arena-case`, `arena-switch` reason selector (`aria-pressed`), dark search-well fields (16px font, 44px targets), `arena-ledger-row` chat-log row, and lit primary Submit Report / Go Back actions.
- **Invite Code (`/i/:code`)**: `src/pages/InviteCodePage.tsx`, `src/pages/InviteCodePage.css` — replaced `InvitePage.css` coupling with `arena-workspace`, `ArenaWorkspaceHeader`, and a centered `arena-case` for loading and failed invite states; `InvitePage.css` remains untouched for `InvitePage`.
- **Not Found (`*`)**: `src/pages/NotFoundPage.tsx`, `src/pages/NotFoundPage.css` — wrapped in `<main className="arena-workspace not-found-page">` with `ArenaWorkspaceHeader`, `arena-case`, and `ArenaEmptyState`, upgrading it from `UNKNOWN` to `Converted` in the inventory.

## Verification

- Commit 1 surface pins recorded on unchanged `origin/main` and verified unchanged after conversion:
  - `tests/components/publicProfilePageIsPinned.test.tsx`
  - `tests/components/reportPlayerPageIsPinned.test.tsx`
  - `tests/components/inviteCodePageIsPinned.test.tsx`
  - `tests/components/notFoundPageIsPinned.test.tsx`
- Scoping contract: `tests/unit/playerPagesP7ArenaDressIsScoped.test.ts`
- Ratchet entries added via `node scripts/smarterdesign-inventory.mjs --ratchet` for `PublicProfilePage`, `ReportPlayerPage`, `InviteCodePage`, and `NotFoundPage`.
- History entry added at `docs/club-operations/smarterdesign-history.d/2026-11-28-p7-public-profile-report-invite-notfound.md`.
- Before/after renders captured at 393px and 1280px.
