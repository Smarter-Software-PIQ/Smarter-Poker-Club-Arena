# Club Operations polish and every tool page in #SmarterDesign (2026-11-27)

Follow-up to PR #12262. Dan asked for every page Club Operations opens to carry #SmarterDesign, and for the remaining polish to be finished.

## Polish on the rail pages

- **Header name flash:** the mast shows the real club name from the first frame through `src/components/ops/useArenaClubName.ts`. It tries, in order, the page's read, the membership list already in `useClubStore`, then the route slug. It never shows the generic "Club Arena"; `ArenaWorkspaceHeader` prints nothing rather than a placeholder.
- **Double-lit rail:** the identity key lights, and carries `aria-current`, only when the strip has no item for the current page. Exactly one key is lit on Overview.
- **Dashboard meters:** Members, Online, Live Tables and Seated sit under the mast, from data the page already reads.
- **Width:** Reports and Hand Review run the full content width; the 1000px cap is gone.
- **Status line:** "Updated Just Now" is in chrome type, not the old spaced lettering.
- **One look for empty, loading and error:** a shared `ArenaState` in `src/components/ops/ArenaOps.tsx` replaces every hand-built empty, loading and error screen on these pages, with the same wording.

## Tool pages rebuilt (painted plates removed)

- **Applicants, Blacklist, Disputes, Anti-Cheat, Club Rules, Announcements:** `ClubApplicantsPage`, `BlacklistManagerPage`, `DisputeManagementPage`, `AntiCheatPage`, `ClubRulesPage`, `ClubAnnouncementsPage`.
- **Agent Team and Agent Network:** `AgentManagementPage`, and `SuperAgentDashboard`, which the club Agent Network route actually renders. `AgentDashboardPage` (the stand-alone `/agent-dashboard`) is rebuilt too.
- **Financials, Settlement, Insurance Report, Bomb Pot Report:** `ClubFinancialsPage` with `FinancialChart`, the `SettlementPage` wrapper, `ClubInsuranceReportPage` and `ClubBombPotReportPage`.
- **Diamond Wheel, Diamond Games, Diamond Costs:** `ClubWheelOperationsPage`, `ClubDiamondGamesOperationsPage`, `ClubDiamondCostsPage` and their own children, on a small shared kit, `src/components/club/DiamondOpsKit.tsx`.
- **Player Offers, Promo Vault, Table Management, Lightning:** `PromotionsPage`, `PromoVaultPage`, `GameManagementPage` with its ticker and message panels, and `ClubLightningOperationsPage` with `src/pages/club/lightning/`.

Each page has the arena workspace root, the mast with the club name, chrome meters, chrome cases, lit chrome keys, chrome rows, dark wells and `ArenaState`. Charts use smarter.poker blue, gold and red only. Behaviour, data reads, aria and wording are unchanged. Test pins that named the painted `SpadeConsole` were moved to the arena pieces in the same change.

## Not changed

- `WeeklyAccountingWorkspace` and `DiamondSpinsOwnerTerms`: both are shared with pages outside Club Operations, so they now sit inside the new chrome but keep their own look.
- The union variant of Diamond Costs: it has no union name on its mast, because the page reads none.

## Found in the before/after review

- **Table Management:** the create row (Add Table, Event, Spins, Sit N Go) was still the painted rail. `GameCreationActions` now takes `arena` and renders chrome keys there. The Club home and Union pages keep the painted rail.
- **Blacklist:** "Add Exclusion" spans the row under the meters instead of sitting small on the left.
- **Render harness:**
  - It gives each checkout its own dependency cache, because two checkouts sharing `node_modules` loaded two copies of React and crashed chart pages.
  - Its fixtures now answer the game-management access check.
  - A new `probe.mjs` prints a route's console errors.
