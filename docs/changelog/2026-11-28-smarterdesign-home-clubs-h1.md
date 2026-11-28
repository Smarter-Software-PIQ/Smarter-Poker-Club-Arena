# 2026-11-28 — #SmarterDesign Batch H1: HomePage, ClubsPage, and PokerArenaLandingPage

## Summary

Converted `ClubsPage` (`/clubs-list`, including `ClubDiscovery`), `HomePage` (`/`), and `PokerArenaLandingPage` (`/`, signed-out public landing) onto the `#SmarterDesign` arena workspace language (`ArenaWorkspace.css` + `ArenaOps.css`).

## Changes

- **`src/pages/ClubsPage.tsx` & `src/pages/ClubsPage.module.css` + `src/components/clubs/ClubDiscovery.tsx` & `src/components/clubs/ClubDiscovery.css`**: Replaced all six painted `SpadeConsole` frames and `PageBar` with an `arena-workspace` root, `ArenaWorkspaceHeader` mast, `arena-case` sections, dark `arena-ops-well` search input, chrome tab/filter/action `arena-switch` controls, engraved ledger rows, and `ArenaEmptyState`.
- **`src/pages/HomePage.tsx` & `src/pages/HomePage.module.css`**: Added `arena-workspace` root (keeping `GlobalHeader` full-bleed) and `ArenaWorkspaceHeader` mast, and converted the three non-dialog `SpadeConsole` sections (error boundary, load failed, empty onboarding) to `arena-case` sections while keeping `ClubEntryActionBar`, `CarouselSection`, and the two `onClose` modal dialogs unchanged.
- **`src/pages/PokerArenaLandingPage.tsx` & `src/pages/PokerArenaLandingPage.module.css`**: Preserved the prerender `<main className={styles.page} id="main-content" tabIndex={-1}>` landmark, all literal `trackCta(...)` analytics calls, `signInUrl(returnPathAfterSignIn())`, and real `<a href>` CTAs while converting all five painted `SpadeConsole` sections to `arena-workspace`, `ArenaWorkspaceHeader`, and `arena-case` sections.
- **Tests & Ratchet**: Added Commit 1 `surfacePin` tests (`clubsPageIsPinned`, `homePageIsPinned`, `pokerArenaLandingPageIsPinned`), scoping test `homeClubsH1ArenaDressIsScoped`, ratchet entries in `docs/club-operations/smarterdesign.d/{ClubsPage,HomePage,PokerArenaLandingPage}`, and batch history `docs/club-operations/smarterdesign-history.d/2026-11-28-h1-home-clubs-landing.md`.
