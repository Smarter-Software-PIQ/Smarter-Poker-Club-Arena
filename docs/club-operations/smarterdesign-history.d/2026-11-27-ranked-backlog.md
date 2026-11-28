## Ranked backlog

The hand-kept plan of 2026-11-27. It went stale within a day (PR #12312 converted
seven of its pages while it still listed them as to-do), which is why the
inventory is now read from the code. Do not pick work from it: run
`node scripts/smarterdesign-inventory.mjs` and `--claims`.

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

| Rank | Surface                            | File                                                | Today                                                                                               |
| ---- | ---------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 10   | Disputes (body) (done, batch 3)    | `src/pages/DisputeManagementPage.tsx`               | Integrity mast already arena; case list still sits in painted `SpadeConsole`.                       |
| 11   | Blacklist (body) (done, batch 4)   | `src/pages/BlacklistManagerPage.tsx`                | Integrity mast already arena; form and ledger are its own module dress (rounded panels, gradients). |
| 12   | Anti-Cheat (done, #12312)          | `src/pages/AntiCheatPage.tsx`                       | 1,547 lines, own module dress, 1 e2e spec.                                                          |
| 13   | Agent Network (done, #12312)       | `src/pages/SuperAgentDashboard.tsx`                 | Rounded stat cards with glyph icons, gradient tabs (10 radius, 13 gradients).                       |
| 14   | Promo Vault (done, #12312)         | `src/pages/PromoVaultPage.tsx`                      | Own rounded dress (17 radius, 11 gradients), 1,241 lines.                                           |
| 15   | Financials (done, batch 4b)        | `src/pages/ClubFinancialsPage.tsx`                  | Heavy painted `SpadeConsole` use (21 references), 11 tests.                                         |
| 16   | Diamond Wheel ops (done, batch 4b) | `src/pages/club/ClubWheelOperationsPage.tsx`        | Painted `SpadeConsole` on the shared `diamondGames.module.css`.                                     |
| 17   | Diamond Games ops (done, batch 4b) | `src/pages/club/ClubDiamondGamesOperationsPage.tsx` | Same shared sheet as Diamond Wheel ops; convert together.                                           |
| 18   | Agent Team (done, #12312)          | `src/pages/AgentManagementPage.tsx`                 | 1,839 lines, painted `SpadeConsole` (11), 9 tests.                                                  |

### Tier 3: risky (shared or heavily pinned), later batches

| Rank | Surface                         | File                                           | Why it waits                                                                                                   |
| ---- | ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 19   | Table Management (done, #12312) | `src/pages/GameManagementPage.tsx`             | 2,251 lines, 22 tests, shared by club and union routes.                                                        |
| 20   | Diamond Costs (done, #12312)    | `src/pages/club/ClubDiamondCostsPage.tsx`      | 4,130 lines, 35 painted references, shared by club and union routes.                                           |
| 21   | Club Home / Lobby               | `src/pages/ClubHomePage.tsx`                   | 6,880 lines, 127 tests and 10 e2e specs; the lobby cards are their own master (`ArenaGameCard`). Do not sweep. |
| 22   | Tournament Lobby                | `src/pages/tournament/TournamentLobbyPage.tsx` | 20 tests; tournament console surfaces are pinned.                                                              |
| 23   | Union Operations                | `src/pages/UnionDashboardPage.tsx`             | 3,394 lines on `AdminDashboardPage.css`, shared with `AgentDashboardPage.tsx`.                                 |
| 24   | Agent Dashboard (done, #12312)  | `src/pages/AgentDashboardPage.tsx`             | Shares `AdminDashboardPage.css` with Union Operations; convert together.                                       |

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
