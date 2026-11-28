# #SmarterDesign Inventory (2026-11-27)

Dan, 2026-11-27, on the bottom of Player Management: "NO DO NOT USE THOSE
BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE".
#SmarterDesign is the arena workspace language in
`src/components/lobby/ArenaWorkspace.css` (and `src/components/ops/ArenaOps.css`):
the `.arena-workspace` shell and chrome mast, the thin chrome `.arena-case`,
`.arena-section-title`, `.arena-meter` readouts, `.arena-switch` chrome keys
with the lit blue primary, `.arena-ledger-row` chrome rows and the dark search
wells. It is NOT the painted `SpadeConsole` frame.

## How this list was made

- Every route in `src/App.tsx` was resolved to its page component (guards
  skipped) and checked for `arena-workspace` / `ArenaWorkspaceHeader`.
- `.claude/skills/club-arena-console/scripts/find-generic-surfaces.mjs` was
  run. It reports `0 to go`, because it measures distance from the painted
  #ClubArenaConsole kit, so a painted `SpadeConsole` page counts as finished
  there. Under #SmarterDesign those painted page sections are the old style,
  so they are listed here too.
- Each candidate was graded by its stylesheet (rounded corners, gradients,
  plain text-link buttons), its `SpadeConsole` use, and how many tests and
  e2e specs name it. Batch 1 surfaces were rendered at 393px and 1440px.

Ranked by player and operator traffic first, then by how cheaply it converts
with the existing classes. "Cheap" means the page already has a simple
section structure, or it uses `SpadeConsole`, which converts by aliasing
`ClubPageSection` with `arena` (the route #12262 used for Reports and Hand
Review).

## Already on #SmarterDesign (left out)

Club Operations Overview, Dashboard, Finance Overview, Control Overview,
Players (`ClubMembersPage`), player detail (`MemberManagementPage`), Club Data,
Cashier (`CashierPage`, `CashierTradePage`), Reports, Hand Review, Settings,
Player Stats, the Play / Rewards / Community / Legal workspaces, and the
integrity mast on Disputes and Blacklist. The table and felt are out of scope.

## Batch 1 (this PR)

| #   | Surface       | File                                  | What changed                                                                                                    |
| --- | ------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Applicants    | `src/pages/ClubApplicantsPage.tsx`    | Plain cyan text links on black became the chrome mast, a chrome case, chrome ledger rows and keys; Approve lit. |
| 2   | Club Rules    | `src/pages/ClubRulesPage.tsx`         | Painted spade console became the thin chrome case; Copy / Edit Rules a chrome switch.                           |
| 3   | Announcements | `src/pages/ClubAnnouncementsPage.tsx` | Painted spade console became the chrome case; each post a chrome row; Pin / Delete and Refresh / New Post keys. |

## Batch 2

| #   | Surface                | File                                                                              | What changed                                                                                                                                                                                                                                        |
| --- | ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | Bomb Pot Report        | `src/pages/club/ClubBombPotReportPage.tsx`                                        | Painted spade console became the chrome case (`ClubPageSection arena`); the window a chrome switch; the six totals chrome meters; each table a chrome ledger row; Back / Export CSV chrome keys, Export lit.                                        |
| 5   | Insurance Report       | `src/pages/club/ClubInsuranceReportPage.tsx`                                      | Same as Bomb Pot Report: funnel and money as chrome meters, each day a chrome ledger row with its net.                                                                                                                                              |
| 6   | Lightning (operations) | `src/pages/club/ClubLightningOperationsPage.tsx`, `src/pages/club/lightning/*`    | Overview and Cluster detail moved to the chrome case; every in-page choice and action group is a chrome switch (choice lit by aria-pressed, a lone action lit); each Cluster and signal a chrome row. The control dialogs keep their popup chassis. |
| 7   | Player Offers          | `src/pages/PromotionsPage.tsx`, `src/components/rewards/RewardsSurfaceHeader.tsx` | `RewardsSurfaceHeader` gained an opt-in `arena` prop (the other 18 pages that use it are unchanged). Views a chrome switch, each offer a chrome row, Claim a lit key, Invite Friends / Daily Bonus chrome keys.                                     |
| 8   | Cashier Statements     | `src/pages/CashierStatementsPage.tsx`                                             | Lit words on flat glass became the Cashier's arena dress: each section a chrome case, range and filter choices chrome switches, totals chrome meters, entries chrome rows, actions chrome keys, fields dark wells.                                  |

Left as lit words on purpose: the Lightning reconcile row's Trail and the feature
flag Turn On / Off cell words (single words inside grid cells), and the Cashier
Statements Load More / Retry words. The Lightning confirmation dialogs portal to
the body on their painted popup chassis, which is a popup, not a page section.

## Batch 3

| #   | Surface             | File                                       | What changed                                                                                                                                                                                                                                                         |
| --- | ------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Welcome Message     | `src/pages/ClubWelcomeMessagePage.tsx`     | Painted console became the chrome case; the selects and the message dark wells; Reload / Save Message chrome keys with Save lit.                                                                                                                                     |
| 10  | Banner Displays     | `src/pages/ClubBannerDisplaysPage.tsx`     | Chrome case; the preview under a chrome section title; the file picker a dark well; Remove Club Banner and Reload chrome keys; Back To Club / Save Banner the case keys with Save lit.                                                                               |
| 11  | Settlement          | `src/pages/SettlementPage.tsx`             | Shell only: the painted console became the chrome case and Back a chrome key. `WeeklyAccountingWorkspace` inside, every figure, handler and hook, is untouched.                                                                                                      |
| 12  | Table Bomb Settings | `src/pages/club/TableBombSettingsPage.tsx` | Chrome case; the trigger one chrome switch lit by aria-pressed; every number and choice a dark well; rows under chrome hairlines; Back / Save Settings chrome keys with Save lit.                                                                                    |
| 13  | Disputes (body)     | `src/pages/DisputeManagementPage.tsx`      | Docket moved to the chrome case under the arena integrity mast; status filter a chrome switch lit by aria-selected; fields dark wells; every case a chrome row; Start Review, Resolve, Escalate and Withdraw chrome keys (Resolve green, Escalate and Withdraw red). |

Still old inside on purpose: `WeeklyAccountingWorkspace` (the Settlement body)
prints its own lit words. It is a money screen shared with the Settlement
Dashboard and needs its own pass with its figure hooks pinned first.

## Batch 4

| #   | Surface          | File                                 | What changed                                                                                                                                                                                                                                      |
| --- | ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | Blacklist (body) | `src/pages/BlacklistManagerPage.tsx` | Cut-corner panels became chrome cases; every control a chrome key (Add Exclusion lit; Apply Exclusion, Confirm, Remove From Play and Remove Access Control keep red ink); fields dark wells; each exclusion and roster match a chrome ledger row. |

Diamond Wheel ops, Diamond Games ops and Financials are in progress as one
full pass (with `DiamondGamesMoney` and the Financials embeds), so no page
ships with painted and chrome frames mixed on one screen.

## Ranked backlog

### Tier 1: high traffic, cheap

| Rank | Surface                                | File                                             | Today                                                                                                                                                                     |
| ---- | -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Cashier Statements (done, batch 2)     | `src/pages/CashierStatementsPage.tsx`            | Lit words on flat glass under the cashier page bar; range and filter choices are plain text. Linked from the Cashier. Needs an account-scope harness stub to render data. |
| 2    | Player Offers (done, batch 2)          | `src/pages/PromotionsPage.tsx`                   | Flat page sheet, no frames (0 radius); Club Control rail page. 10 tests read the file.                                                                                    |
| 3    | Lightning (operations) (done, batch 2) | `src/pages/club/ClubLightningOperationsPage.tsx` | Painted `SpadeConsole` sections; converts by the `ClubPageSection arena` alias.                                                                                           |
| 4    | Bomb Pot Report (done, batch 2)        | `src/pages/club/ClubBombPotReportPage.tsx`       | Painted `SpadeConsole` report sections.                                                                                                                                   |
| 5    | Insurance Report (done, batch 2)       | `src/pages/club/ClubInsuranceReportPage.tsx`     | Painted `SpadeConsole` report sections.                                                                                                                                   |
| 6    | Welcome Message (done, batch 3)        | `src/pages/ClubWelcomeMessagePage.tsx`           | Painted `SpadeConsole`, small (298 lines), no tests.                                                                                                                      |
| 7    | Banner Displays (done, batch 3)        | `src/pages/ClubBannerDisplaysPage.tsx`           | Painted `SpadeConsole`, small (225 lines).                                                                                                                                |
| 8    | Settlement (done, batch 3)             | `src/pages/SettlementPage.tsx`                   | 50-line painted `SpadeConsole` shell around the settlement panels.                                                                                                        |
| 9    | Table Bomb Settings (done, batch 3)    | `src/pages/club/TableBombSettingsPage.tsx`       | Painted `SpadeConsole` form sections.                                                                                                                                     |

### Tier 2: high traffic, more work

| Rank | Surface                                    | File                                                | Today                                                                                               |
| ---- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 10   | Disputes (body) (done, batch 3)            | `src/pages/DisputeManagementPage.tsx`               | Integrity mast already arena; case list still sits in painted `SpadeConsole`.                       |
| 11   | Blacklist (body) (done, batch 4)           | `src/pages/BlacklistManagerPage.tsx`                | Integrity mast already arena; form and ledger are its own module dress (rounded panels, gradients). |
| 12   | Anti-Cheat                                 | `src/pages/AntiCheatPage.tsx`                       | 1,547 lines, own module dress, 1 e2e spec.                                                          |
| 13   | Agent Network                              | `src/pages/SuperAgentDashboard.tsx`                 | Rounded stat cards with glyph icons, gradient tabs (10 radius, 13 gradients).                       |
| 14   | Promo Vault                                | `src/pages/PromoVaultPage.tsx`                      | Own rounded dress (17 radius, 11 gradients), 1,241 lines.                                           |
| 15   | Financials (in progress, full pass)        | `src/pages/ClubFinancialsPage.tsx`                  | Heavy painted `SpadeConsole` use (21 references), 11 tests.                                         |
| 16   | Diamond Wheel ops (in progress, full pass) | `src/pages/club/ClubWheelOperationsPage.tsx`        | Painted `SpadeConsole` on the shared `diamondGames.module.css`.                                     |
| 17   | Diamond Games ops (in progress, full pass) | `src/pages/club/ClubDiamondGamesOperationsPage.tsx` | Same shared sheet as Diamond Wheel ops; convert together.                                           |
| 18   | Agent Team                                 | `src/pages/AgentManagementPage.tsx`                 | 1,839 lines, painted `SpadeConsole` (11), 9 tests.                                                  |

### Tier 3: risky (shared or heavily pinned), later batches

| Rank | Surface           | File                                           | Why it waits                                                                                                   |
| ---- | ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 19   | Table Management  | `src/pages/GameManagementPage.tsx`             | 2,251 lines, 22 tests, shared by club and union routes.                                                        |
| 20   | Diamond Costs     | `src/pages/club/ClubDiamondCostsPage.tsx`      | 4,130 lines, 35 painted references, shared by club and union routes.                                           |
| 21   | Club Home / Lobby | `src/pages/ClubHomePage.tsx`                   | 6,880 lines, 127 tests and 10 e2e specs; the lobby cards are their own master (`ArenaGameCard`). Do not sweep. |
| 22   | Tournament Lobby  | `src/pages/tournament/TournamentLobbyPage.tsx` | 20 tests; tournament console surfaces are pinned.                                                              |
| 23   | Union Operations  | `src/pages/UnionDashboardPage.tsx`             | 3,394 lines on `AdminDashboardPage.css`, shared with `AgentDashboardPage.tsx`.                                 |
| 24   | Agent Dashboard   | `src/pages/AgentDashboardPage.tsx`             | Shares `AdminDashboardPage.css` with Union Operations; convert together.                                       |

### Player pages (outside Club Operations)

| Rank | Surface           | File                                                 | Today                                                                  |
| ---- | ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| 25   | Hand History      | `src/pages/HandHistoryPage.tsx`                      | Own sheet, no frames; 24 tests read it.                                |
| 26   | Wallet            | `src/pages/PlayerWalletPage.tsx`                     | Uses `CashierWorkspace` but not the arena shell; 25 tests.             |
| 27   | Rakeback          | `src/pages/RakebackPage.tsx`                         | Small flat page (383 lines).                                           |
| 28   | Transactions      | `src/pages/TransactionHistoryPage.tsx`               | 103-line flat page.                                                    |
| 29   | Session History   | `src/pages/SessionHistoryPage.tsx`                   | Flat page.                                                             |
| 30   | Notifications     | `src/pages/NotificationsPage.tsx`                    | Own sheet, 13 tests, 1 e2e spec.                                       |
| 31   | Player Statistics | `src/pages/PlayerStatisticsPage.tsx`                 | Own sheet, 1 e2e spec.                                                 |
| 32   | Friends, VIP      | `src/pages/FriendsPage.tsx`, `src/pages/VIPPage.tsx` | Own sheets. Check for #SmarterCasinoRealism contracts before touching. |
| 33   | Create Table      | `src/pages/CreateTablePage.tsx`                      | Small; game choice uses the lobby card art, which stays.               |

Left out on purpose: Leaderboard, Daily Challenges, Achievements, Bad Beat
Jackpot and the Diamond games (`DiamondWheelPage`, Plinko, Crash, Mines) sit on
other approved masters (#SmarterCasinoRealism or the painted game art; see
the club-arena-console skill, step 1.5). Platform staff desks (`src/pages/admin/*`,
Financial Admin, Engine) are internal tools. The front door
(`InvitePage`, Auth) keeps its own dress.

## Recommended Batch 5

The money pages as one full pass: Diamond Wheel ops and Diamond Games ops with
`DiamondGamesMoney`, and Financials with every embed (`ClubFinancialDashboard`,
`RakeReports`, `TransactionLedgerView`, `ChipStatement`, `DynamicWallet`),
their figure hooks pinned by tests first. Then the Settlement body
(`WeeklyAccountingWorkspace`), Agent Team and Agent Network.
