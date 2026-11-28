# 2026-11-28 — #SmarterDesign Batch G1: Table Config, Create Table, Club Advertise, and Tournament Archive

Converted four routed Club Arena pages (and completed `GameManagementPage` by removing its last nested `SpadeConsole`) onto the `#SmarterDesign` arena workspace language (`ArenaWorkspace.css` + `ArenaOps.css`):

- **`src/pages/TableConfigPage.tsx` + `.css`**: Replaced the last `SpadeConsole` with `<section className="arena-case arena-ops-case">` (no duplicate mast in embedded mode inside `GameManagementPage`; `arena-workspace` + `ArenaWorkspaceHeader` on the standalone route), dressed mode tabs and tournament footer actions on `arena-switch` with `Start` lit, and put form fields in dark wells. This also transitions `GameManagementPage` from `partial` to `Converted`.
- **`src/pages/CreateTablePage.tsx` + `.css`**: Added `arena-workspace` + `ArenaWorkspaceHeader` on the standalone route with the `Back` key above the mast while keeping embedded mode clean inside `GameManagementPage` and preserving all nine painted `ArenaGameCard` lobby cards unframed.
- **`src/pages/ClubAdvertisePage.tsx` + `.css`**: Replaced all eight `SpadeConsole` sections across club mode, sponsor mode, staff refusal, and load error with `arena-workspace`, `ArenaWorkspaceHeader`, `arena-meter` diamond balance and cost readouts, `arena-case` sections, `arena-switch` keys, dark search-well fields, and `arena-ledger-row` rate/campaign rows.
- **`src/pages/tournament/TournamentResultsPage.tsx` + `.css`**: Replaced `RewardsSurfaceHeader` (`CasinoSurfaceHeader`) and inline slate cards with `arena-workspace`, `ArenaWorkspaceHeader`, `arena-case`, `arena-switch`, `arena-meter`, and `arena-ledger-row` while preserving every prize, bounty, mystery chest, Diamond-unit, satellite, spin, and hand-history calculation and figure.

## Verification

- Baseline pin tests committed on unchanged `origin/main` and verified unchanged after conversion (`tests/components/{tableConfig,createTable,clubAdvertise,tournamentResults}PageIsPinned.test.tsx`).
- Scoping unit test added (`tests/unit/gamesG1ArenaDressIsScoped.test.ts`).
- Ratchet entries added via `node scripts/smarterdesign-inventory.mjs --ratchet` for `TableConfigPage`, `GameManagementPage`, `CreateTablePage`, `ClubAdvertisePage`, and `TournamentResultsPage`.
- History entry added at `docs/club-operations/smarterdesign-history.d/2026-11-28-g1-games-advertise-results.md`.
