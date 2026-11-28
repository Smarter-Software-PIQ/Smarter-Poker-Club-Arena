# #SmarterDesign Batch T2: XMTT, Club Tournaments, and Share/Replay Pages (2026-11-28)

Converted six routed pages onto the `#SmarterDesign` arena workspace language (`ArenaWorkspace.css` + `ArenaOps.css`):

- `XMTTPage` (`/xmtt`): replaced five painted `SpadeConsole` sections with `arena-workspace`, `ArenaWorkspaceHeader`, `ClubPageSection` (`arena`), `arena-switch` filter/action bars, and `arena-ledger-row` figure/player rows while preserving `[data-tournament-id]`, `[data-xmtt-total]`, and the exact `Load More` button label.
- `TournamentPage` (`/clubs/:clubId/tournaments`): replaced six painted `SpadeConsole` sections with `arena-workspace`, `ArenaWorkspaceHeader`, `ClubPageSection` (`arena`), `arena-switch` controls, and `arena-ledger-row` rows. Added scoped `TournamentPageArena.css` and left the shared `CreateTournamentModal` styles in `TournamentPage.css` untouched.
- `MysteryBountyPanel`: added an opt-in `arena` prop with scoped `MysteryBountyArena.css` so `TournamentPage` renders it in the arena workspace while `BountiesTab` (`TournamentDetails`) keeps its painted console.
- `HandReplayerPage` (`/share/hand/:handId`), `SharedHandReplayPage` (`/replay`), `ShortHandReplayPage` (`/h/:token`), and `SharedBonusReplayPage` (`/bonus-replay/:shareId`): wrapped viewer-facing states in `arena-workspace`, `ArenaWorkspaceHeader`, and `arena-case` sections, replacing the `SharedHandReplayPage` join `SpadeConsole` with a chrome case and switch, while preserving `/replay?clip=1` clip-mode DOM and CSS verbatim for World Hub `/api/cron/render-hand-clips`.

## Verification

- Surface pin tests committed on unchanged `origin/main` before conversion and verified unchanged after conversion:
  - `tests/components/xmttPageIsPinned.test.tsx`
  - `tests/components/tournamentPageIsPinned.test.tsx`
  - `tests/components/shareReplayPagesArePinned.test.tsx`
- Arena CSS scoping and shared-component opt-in test: `tests/unit/tournamentsReplayT2ArenaDressIsScoped.test.ts`.
- Ratchet entries added under `docs/club-operations/smarterdesign.d/` via `node scripts/smarterdesign-inventory.mjs --ratchet` and batch history recorded in `docs/club-operations/smarterdesign-history.d/2026-11-28-t2-tournaments-and-replays.md`.
