# #SmarterDesign Batch History (hand-written)

This file is the record of what each #SmarterDesign batch converted and why. It
is history: it is NOT the current state. The current state of every routed page
is [SMARTERDESIGN-INVENTORY.md](./SMARTERDESIGN-INVENTORY.md), which is
generated from the code by `node scripts/smarterdesign-inventory.mjs --write`
and pinned by `tests/the-smarterdesign-inventory-matches-the-code.law.test.ts`.
The "Ranked backlog" below was the hand-kept plan of 2026-11-27; it went stale
within a day (PR #12312 converted seven of its pages while it still listed them
as to-do), which is why the inventory is now generated. Do not pick work from
the backlog here; pick it from the inventory and run `--claims` first.

Dan, 2026-11-27, on the bottom of Player Management: "NO DO NOT USE THOSE
BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE".

## Already on #SmarterDesign (left out)

Club Operations Overview, Dashboard, Finance Overview, Control Overview,
Players (`ClubMembersPage`), player detail (`MemberManagementPage`), Club Data,
Cashier (`CashierPage`, `CashierTradePage`), Reports, Hand Review, Settings,
Player Stats, the Play / Rewards / Community / Legal workspaces, and the
integrity mast on Disputes and Blacklist. The poker table's consoles, popups,
drawer and sheets are done (see "The poker table" below); the felt itself is out of scope.

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

The Settlement body (`WeeklyAccountingWorkspace`) was converted in batch 5.

## Batch 4

| #   | Surface          | File                                 | What changed                                                                                                                                                                                                                                      |
| --- | ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | Blacklist (body) | `src/pages/BlacklistManagerPage.tsx` | Cut-corner panels became chrome cases; every control a chrome key (Add Exclusion lit; Apply Exclusion, Confirm, Remove From Play and Remove Access Control keep red ink); fields dark wells; each exclusion and roster match a chrome ledger row. |

## Batch 4b: the money pages, one full pass

| #   | Surface           | File                                                | What changed                                                                                                                                                                                                                                                       |
| --- | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 15  | Financials        | `src/pages/ClubFinancialsPage.tsx`                  | All ten frames, `ClubFinancialDashboard`, `RakeReports` and `ChipStatement` in chrome cases (the last two by an opt-in arena prop, so the Cashier Rake Treasury dialog and wallet pages keep painted); `DynamicWallet` in a chrome case with its approved row art. |
| 16  | Diamond Wheel ops | `src/pages/club/ClubWheelOperationsPage.tsx`        | Every section in a chrome case, `DiamondGamesMoney`, Daily Diamond Statements and Owner Agreement included; the 640px column kept.                                                                                                                                 |
| 17  | Diamond Games ops | `src/pages/club/ClubDiamondGamesOperationsPage.tsx` | Same pass on the shared sheet; the player-facing game pages that share `diamondGames.module.css` are untouched.                                                                                                                                                    |

Every printed figure and data hook on these pages was pinned against the old
painted components first with `tests/helpers/moneyFigures.ts` and is unchanged
(PR #12304, merge `f3a649b62`).

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

## Batch 5: the Settlement body

| #   | Surface         | File                                                      | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 18  | Settlement body | `src/components/accounting/WeeklyAccountingWorkspace.tsx` | The heading is the case's section title; Week Ending Monday a chrome row with a dark well; the automatic run status a chrome row with Refresh Status lit; Club Weekly Summaries under a hairline with Refresh lit and Export steel, its table on a chrome row rim; recorded union periods one chrome row each; the cashier link a chrome key. Dress lives in `WeeklyAccountingArena.css`, scoped under `.arena-workspace`, so the Settlement Dashboard, Union Statements and admin dashboard that share these components keep their look. Every figure, word and region pinned first (`tests/components/weeklyAccountingFiguresArePinned.test.tsx`) and unchanged. |

PR #12312 converted the shells of Anti-Cheat, Agent Network, Promo Vault, Agent
Team, Table Management, Diamond Costs and Agent Dashboard.

## Batch 6: Agent Team, Hierarchy and Payouts tab bodies

| #   | Surface       | File                                                                                           | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 19  | Hierarchy tab | `src/components/agent/AgentAssignmentPanel.tsx`, `AgentAssignmentHistory.tsx`, `AgentTree.tsx` | Assign And Transfer moved off the painted console onto `ClubPageSection arena`; fields dark wells; Review Assignment Or Transfer lit; the review and each history record a chrome row with a Transfer Details chevron disclosure. The tree is a chrome case: search well, chrome keys, one chrome row per agent with four readout tiles (two across on a phone, so no figure is cut short), a chevron expander on a 44px target and Send Chips a chrome key. |
| 20  | Payouts tab   | `src/components/agent/AgentCashoutPanel.tsx`, `AgentCashoutArena.css`                          | Pending Cashouts in a chrome case by an opt-in `arena` prop that only Agent Team passes; Refresh, Approve Cashout (lit), Reject (error ink), Send To Notice Board and Retry chrome keys; each request a chrome row. The Cashier trade dialog and the player record keep the painted console; their markup is unchanged apart from a layout-neutral key wrapper (`display: contents`).                                                                        |

Every printed figure, word, named region and control was pinned first against
the old components (`tests/components/agentTeamTabBodiesArePinned.test.tsx`),
and the arena cashout case is asserted to print exactly what the console
prints. Every dress rule is scoped under `.arena-workspace`
(`tests/unit/agentTeamArenaDressIsScoped.test.ts`).

## The poker table (done)

The table's consoles, popups, drawer, sheets, chat, tab strip, masthead and
Hand History / Hand Detail wear #SmarterDesign: ink navy, one thin chrome rim,
white titles, silver support ink, ice and cyan emphasis, cobalt for the lit
primary, Title Case printed at the source and no gold anywhere in UI ink.

| PR     | What it did                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #12280 | The table's consoles and popups on the #SmarterDesign skin.                                                                                                                                                                                                                                          |
| #12302 | The drawer, sheets and chat on the skin; controller theme swatches keep their own frames.                                                                                                                                                                                                            |
| #12316 | Table chat names each sender at read time.                                                                                                                                                                                                                                                           |
| #12321 | The leftovers measured live: Title Case and no gold on every table surface; Hand Detail inks inside the skin.                                                                                                                                                                                        |
| #12328 | The last of it: the tab strip's turn pulse and the winner sparkles in ice and white (animations unchanged), the masthead's club and union names Title Cased at the print site, stored values and literals the transform used to shout now Title Case, the Hand Detail column key in readable silver. |

Left alone on purpose: the felt, cards, chips, seats and avatars, the player's
purchased Action Controller skin, the Bomb Pot art and the full-screen stage art.

## Recommended Batch 7

Agent Team's remaining tab bodies, which still wear their old dress inside the
converted shell: the Commissions tab (`AgentCommissionDashboard`, rounded
cards and gold buttons) and the Players tab (`PlayerSearch`, Distribution
History, Agent Analytics). Pin their figures first. The player record's
Cash Out Requested section (`MemberManagementPage`) still shows the painted
`AgentCashoutPanel`; passing `arena` there converts it once a before/after is
approved.

## Batch P1: Notifications (player pages)

| #   | Surface       | File                              | What changed                                                                                                                                                                                                                                                                                                                 |
| --- | ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Notifications | `src/pages/NotificationsPage.tsx` | Arena workspace root and mast (the page's own heading and description); filter and action keys on chrome switches with Mark All Read lit; day headings as section titles; every signal a chrome row; Push banner dressed in a scoped sheet. Words and counts pinned (`tests/components/notificationsPageIsPinned.test.tsx`). |

Rakeback, Session History and Transaction History were skipped: #12313 touches the first two, and `tests/unit/cinematicRouteFamilies.test.ts` binds all three to the Rewards Circuit / Play & Review masters.

## Batch P2: Help Center and the legal documents (player pages)

| #   | Surface              | File                                           | What changed                                                                                                                                                                                                                                                                                                 |
| --- | -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2  | Help Center          | `src/pages/HelpPage.tsx`, `HelpPrerender.tsx`  | Arena workspace root and mast (its summary behind the chrome "?"); support actions as chrome keys with Send Support Request lit; the live platform check in a case; destinations and policy links as chrome keys; Frequently Asked Questions as a case with the search well and one ledger row per question. |
| P2  | Four legal documents | `src/components/legal/LegalDocumentLayout.tsx` | Terms, Privacy, Fair Gaming and Promotion Rules share one layout: breadcrumb above the mast, the section index as a case of ledger rows, the document as one case with a section title per section and the prose at a 70ch measure, the four documents as chrome keys lit by aria-current.                   |

Both are prerendered for signed-out readers and crawlers, and the prerender prints the same markup. Every heading, word, region, control and link is pinned in the app and as prerendered (`tests/components/helpAndLegalPagesArePinned.test.tsx`); the dress and the sessionless prerender path are held by `tests/unit/helpAndLegalArenaDressIsScoped.test.ts`. The Legal Center (`/legal`) was left as it is: it has no page module of its own (`LegalWorkspacePage` in `ArenaWorkspacePages.tsx`, shared with Play, Rewards and Community), and the mast has no legal area yet.

## Batch P3: Player Statistics and Wallet (player pages)

| #   | Surface           | File                                 | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3a | Player Statistics | `src/pages/PlayerStatisticsPage.tsx` | Arena root and `stats` mast (title, description and tour behind the chrome "?"), the back key above it; the controls and each card a chrome case under a section title; the range a chrome switch lit by aria-pressed; Game and the custom dates dark wells; Confirm and Try Again lit; every figure a chrome ledger row; the metric definitions a chrome disclosure. Pinned first (`tests/components/playerStatisticsPageIsPinned.test.tsx`). |
| P3b | Wallet            | `src/pages/PlayerWalletPage.tsx`     | Arena root and `cashier` mast; the balance a chrome case with readout tiles; the read status over chrome keys with Add Chips lit; the panes a chrome switch lit by aria-selected; every wallet, ledger entry, id and earn door a chrome row; each pane a chrome case with its primary lit. Dress in `PlayerWalletArena.css`, scoped under the wallet's root. Pinned first (`tests/components/playerWalletPageIsPinned.test.tsx`).              |

Hand History was skipped: `tests/unit/cinematicRouteFamilies.test.ts` (`PLAY_PAGES`) binds `src/pages/HandHistoryPage.tsx` to the Play & Review master (`CasinoSurfaceHeader`, `data-arena-surface="play"`).

## Batch O1: the partial operator pages

The generated inventory listed eleven operator pages as Partial. This batch finishes seven of them.

| #   | Surface             | File                                             | What changed                                                                                                                                                                                                         |
| --- | ------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1a | Welcome Message     | `src/pages/ClubWelcomeMessagePage.tsx`           | The PageBar head became the chrome mast (area control, the club's name, the same help summary); the case no longer leaves 52px for the old "?".                                                                      |
| O1b | Banner Displays     | `src/pages/ClubBannerDisplaysPage.tsx`           | Same as Welcome Message. Back To Club stays a case key beside the lit Save Banner.                                                                                                                                   |
| O1c | Table Bomb Settings | `src/pages/club/TableBombSettingsPage.tsx`       | The chrome mast (area dashboard) on the ready, loading and error states. Back stays a case key beside the lit Save Settings.                                                                                         |
| O1d | Cashier Statements  | `src/pages/CashierStatementsPage.tsx`            | The chrome mast (area cashier) heads the page and Back To Cashier sits above it; the page bar keeps only the live status pill.                                                                                       |
| O1e | Settings: Jackpot   | `src/components/bbj/BBJThresholdPanel.tsx`       | Off the painted console onto the chrome case (`ClubPageSection arena`): each threshold a chrome row, Turn On / Off and Remove chrome keys, the fields dark wells, Add Announcement lit. `BBJThresholdArena.css`.     |
| O1f | Player Offers       | `src/components/leaderboard/LeaderboardCard.tsx` | On its own, the standings print in the chrome case; inside an offer row they take the workspace inks and figures, and Retry Rankings is a chrome key.                                                                |
| O1g | Agent Dashboard     | `src/components/agent/AgentScoreCard.tsx`        | The Performance Score prints no second frame inside the page's Score case: chrome section title with the grade, the overall score on a readout tile, every score and figure a chrome row. `AgentScoreCardArena.css`. |

Every printed figure, word, data hook, named region and control state was recorded on main before the change and holds unchanged after (`tests/components/partialOperatorMastPagesArePinned.test.tsx`, `cashierStatementsMastIsPinned.test.tsx`, `partialOperatorPanelsArePinned.test.tsx`, read by `tests/helpers/surfacePin.ts`). The panel dress is scoped and its single arena host checked by `tests/unit/partialOperatorPanelsArenaIsScoped.test.ts`.

Left for a later batch, as assigned: TournamentDetails, SettlementDashboardPage and UnionStatementsPage. GameManagementPage (the painted section in `TableConfigPage`) is also still Partial.

## Batch P4: Hand History and Transaction History (player pages)

| #   | Surface             | File                                   | What changed                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4  | Transaction History | `src/pages/TransactionHistoryPage.tsx` | Arena workspace root and mast (`area="finance"`, its description behind the chrome "?"); the chip statement and the tournament payments in the arena case through their opt-in `arena` prop; the rakeback week as a case with a ledger row per club; every journal leg and club balance on the chrome row rim; Balance Now as a chrome readout. Shared insides dressed only under the page's arena root.  |
| P4  | Hand History        | `src/pages/HandHistoryPage.tsx`        | Arena workspace root and mast (`area="handreview"`); Won and Biggest Pot on chrome meters under it; Find A Hand as one case (search-well fields, Export For Tracker lit, game mode and filters on chrome switches); loaded-hands figures on readout tiles with Export lit; notes and returns as cases with their keys; every hand a chrome ledger row, its actions on chrome keys (Open Hand Detail lit). |

Dan's order of 2026-11-27 ("THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE") supersedes the older Rewards Circuit and Play & Review anchors for these two routes; `tests/unit/cinematicRouteFamilies.test.ts` now pins the arena shell for both, and the two shared circuit sheets no longer name them (Hand History also dropped `data-arena-surface="play"`, read only by those sheets and that test). Every figure, word, region and control is pinned in every state (`tests/components/handHistoryPageIsPinned.test.tsx`, `tests/components/transactionHistoryPageIsPinned.test.tsx`, committed first and unchanged after); the scoping is held by `tests/unit/handHistoryArenaDressIsScoped.test.ts` and `tests/unit/transactionHistoryArenaDressIsScoped.test.ts`. The hand rundown, the Hand Detail dialog, the replay and the Diamond history dialog keep their own skin. Rakeback and Session History stay with open PR #12313.

## Batch P6: VIP, Daily Bonus and Community Search (player pages)

| #   | Surface          | File                           | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6a | Daily Bonus      | `src/pages/DailyBonusPage.tsx` | Arena workspace root and mast (`area="finance"`, the description behind the chrome "?"); one arena case, Rewards Today, around the sheet's frameless glass. Streak, Multiplier and Resets In on chrome tiles; the week seven tiles with today on the lit rim; every reward and note a chrome row; Claim All / Claim Reward the one lit key, Try Again lit, Use Bonus Spin steel; the loading, failed and not-available states in a dark well. Dress in `DailyBonusPage.css`.    |
| P6b | VIP              | `src/pages/VIPPage.tsx`        | Arena workspace root and mast (`area="finance"`), Syncing on the page bar while the first read is in flight. The membership a case with each monthly allowance on a chrome tile; Your Card a case with the perks as chrome rows; Diamond Activity a case (summaries and months on tiles, filters on a chrome switch lit by aria-pressed, every movement a ledger row); the balance a case with Buy Diamonds lit; Buy Features a case with every feature a row and each Buy lit. |
| P6c | Community Search | `src/pages/SearchPage.tsx`     | Arena workspace root and mast (`area="members"`), the live Results figure on a chrome meter under it. The scanner one arena case: the query in a dark well with Search lit, index health and categories on chrome switches (lit by aria-pressed / aria-selected), history on chrome keys, empty and failed states in dark wells, every club, player, table and tournament a chrome ledger row with its primary key lit.                                                         |

Dan's order of 2026-11-27 ("THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE") supersedes the Rewards Circuit anchor for VIP and Daily Bonus; `tests/unit/cinematicRouteFamilies.test.ts` now pins the arena shell for both (as P4 did for Transactions). Every figure, word, data hook, named region and control (with its pressed, selected and disabled state) is pinned in every state the pages show: loading, ready, empty, failed, claimable, one reward left, a claim in flight, already claimed, a purchase in flight, member and Lifetime VIP, a partial index (`tests/components/dailyBonusPageIsPinned.test.tsx`, `vipPageIsPinned.test.tsx`, `searchPageIsPinned.test.tsx`, committed first on unchanged main and unchanged after). The dress is held by `tests/unit/playerPagesP6ArenaDressIsScoped.test.ts`.

How the shared parts were handled:

- **Daily Bonus sheet.** `DailyBonusSheet.tsx` is edited by open PR #12313, so it was not touched. Its glass variant already carries no frame, so the page dresses its insides from `DailyBonusPage.css` under the page's arena root; the entry modal keeps its painted console.
- **VIP.** `VIPMembershipPlate` and `VIPActivityHistory` take an opt-in `arena` prop that only `/vip` passes (off by default). `VIPPage.css`, `VIPActivityHistory.css` and `VIPPerksGrid.css` keep the painted dress `tests/marketplace-console-visual-contract.test.ts` pins; `VIPPageArena.css` overrides it only under the page root. Those sheets paint their keys with `!important` on a clipped `::before` plate, so the chrome keys answer with `!important` on the same properties and hide the plate. `VIPPerksGrid` takes no prop (the contract pins its call site); its rows are dressed from the page sheet.
- **Search.** The page keeps its CSS module (`tests/community-search-owns-its-classes.law.test.ts`), rewritten as the arena dress with every rule under the module's page root. `CommunitySurfaceHeader` is unchanged for its other host.

Left as they were: the VIP cards, top-up and Diamond history dialogs, the Daily Bonus entry modal, the rewards and community route tabs above the mast, and the all-caps index status words on Search ("LIVE DATA", "PARTIAL INDEX", "RECENT SNAPSHOT"), which the pins hold as literals; Title Casing them is a copy change for its own PR.

## Batch S1: the Settlement Center

| #   | Surface           | File                                    | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Settlement Center | `src/pages/SettlementDashboardPage.tsx` | Two painted spade consoles became the arena workspace: Back a chrome key above the finance mast, the scope a chrome status line, the weekly workspace in a chrome case (its `WeeklyAccountingArena.css` dress now applies), the ledger in a second case under its section title. `TransactionLedgerView` and `FinancialAdminScopeState` gained an opt-in `arena` prop (chrome ledger rows, a lit Try Again or Retry key, the scope states on the mast); their other hosts keep their look. |

Every figure, word, region and control was pinned on main first
(`tests/components/settlementDashboardIsPinned.test.tsx`, eleven states) and
passes unchanged; the dress is held by
`tests/unit/settlementDashboardArenaDressIsScoped.test.ts`.

Union Statements was skipped: open PR #12313 (figures cut, never rounded)
edits `src/pages/UnionStatementsPage.tsx`. Financials still prints its Club
Chip Audit Trail on the painted ledger dress inside an arena case; passing
`arena` to its `TransactionLedgerView` converts it once a before/after is
approved.

## Batch D1: Earn Diamonds, the Lightning entry and Flash Pool

| #   | Surface       | File                               | What changed                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1a | Earn Diamonds | `src/pages/DiamondEarnPage.tsx`    | Off three kinds of painted console: Back To Diamond Spins a chrome key above the finance mast, the Diamond Spins tabs a chrome switch lit by aria-current (opt-in `arena` prop on `DiamondSpinsTabs`, only this page passes it), the allowance, Refer A Friend and every activity an arena case (the old pill on the title's edge, the reward figure under it, its one action lit), the invite link in a dark well. `DiamondEarnPage.css`. |
| D1b | Lightning     | `src/pages/LightningEntryPage.tsx` | Every state in the arena root under a chrome mast (area dashboard). The broken-link, failed-read and held-seat screens leave the flat EmptyState box for a chrome case in the same words (formatPopupText), first key lit. The approved Lightning cash-game card keeps its own art; the line saying why a door is not offered rides a chrome row. The route hook stays on its inner element, empty while resolving.                        |
| D1c | Flash Pool    | `src/pages/FlashPoolPage.tsx`      | The inline-styled flat boxes become the arena workspace: Back a chrome key above the mast (summary and tour behind the chrome "?"); each pool a chrome case titled by its stakes, players and tables on readout tiles (players live when anyone sits), the buy-in in a dark well, Play the one lit key; no pools a chrome case. Play still never joins.                                                                                    |

Every diamond amount, stake, buy-in figure, word, page data hook, live region and control (name, state, field limits) was pinned on main first and holds unchanged after (`tests/components/diamondEarnPageIsPinned.test.tsx`, `lightningEntryPageIsPinned.test.tsx`, `flashPoolPageIsPinned.test.tsx`). Because these pages move content between frames, the pins read sorted lists through `tests/helpers/reflowedSurfacePin.ts` (head, aria-hidden decoration, glyph-only pieces and frame hooks left out). The dress is held by `tests/unit/diamondD1ArenaDressIsScoped.test.ts`.

Skipped: DiamondGamesPage, whose page and `FloorFeed` are edited by open PR #12313 (figures cut, never rounded).
