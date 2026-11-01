# Lobby Filter Audit: November 1, 2026

Scope: the player lobby's cash, MTT, Spins, Sit N Go and Satellite filters; sticky access; countdown and registration copy. No engine, money, game admission or database configuration changes. Production verification is **pending** until the closed nine-case live proof passes. Local passing tests are not a live certificate.

## Control inventory and owning implementation

Every definition, change handler, selected state, predicate and persistence path was read in `AdvancedFilters.tsx`, `advancedFilterSpec.ts`, `lobbyViewPrefs.ts`, the filter/sort callers in `ClubHomePage.tsx`, `lobbySortBridge.ts`, `LobbyTable.tsx`, and the connected tournament presentation/window/trait helpers. Definitions below name stable keys; visible labels retain the approved vocabulary.

| Tab       | Game choices                                                                    | Format / style choices                                                   | Status choices                                           | Feature group                       |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------- |
| HOLDEM    | `nlh`, `pineapple`, `short_deck`                                                | Classic `classic`, Lightning Games `madness`, Madness `straight_madness` | Full, Empty, Seats Available                             | Cash                                |
| OMAHA     | `plo4`, `plo5`, `plo6`, `plo8`                                                  | Same three cash styles                                                   | Same cash statuses                                       | Cash except Seven-Deuce             |
| LIMIT     | `flh`, `flo8`                                                                   | Same three cash styles                                                   | Same cash statuses                                       | Cash plus capability-gated Kill Pot |
| MTT       | `nlh`, `plo4`, `plo5`, `plo6`, `plo8`, `short_deck`, `flh`, `flo8`, `pineapple` | Include Satellites switch                                                | Late Reg Open, Starting Soon, Open Registration, Running | Tournament                          |
| SPIN      | `nlh`, `plo4`, `plo5`, `plo6`                                                   | No format/style selector                                                 | Full, Empty, Seats Available                             | Private, Union Event                |
| SNG       | `nlh`, `plo4`, `plo5`, `plo6`, `plo8`, `short_deck`, `flh`, `flo8`              | SNG SATS `sats`, Regular SNG `regular`                                   | Full, Empty, Seats Available                             | Private, Union Event                |
| SATELLITE | Same nine poker choices as MTT                                                  | Recorded satellites only; no redundant Satellite feature switch          | Running, Open Registration, Late Reg Open, Starting Soon | Tournament except Satellite         |

Cash features: Ante, Straddle, Auto Straddle, Insurance, Run It Twice, BombPot, Multi-Board Bomb, Seven-Deuce, Time Bank, All-In Or Fold. LIMIT adds Kill Pot only when its capability is available. Required and Exclude each expose every available feature. Selecting one side clears that feature from the other side.

Tournament features: PKO, Mystery Bounty, ordinary Bounty, Rebuy, Re-Entry, Add-On, Guaranteed, Late Registration, Satellite, Turbo, Hyper, Private, Union Event. Required means every selected trait; Exclude means any selected trait. PKO, mystery and ordinary bounty remain distinct. The Late Registration trait describes configured terms; Late Reg Open status describes the current entry window.

All seven sheets have minimum/maximum price inputs and four independently toggleable presets. Cash blind bounds: 0.02–5000; Micro 0.02–0.2, Small 0.2–3, Mid 3–8, High 8–5000. Tournament total buy-in bounds: 0–15000; Micro 0–5, Small 5–25, Mid 25–100, High 100–15000. Multiple presets form an inclusive union. Moving a price thumb clears preset selection. Table-size bounds are 2–9; Spins show fixed three seats with no seat sliders. Tournament table size is `table_size`, not total field capacity.

Quick controls reuse the sheet's statuses and stored values. All clears only status selection. Favorites is available in the sticky rail on every non-ALL tab. The redundant Favorites shortcut in the status row was replaced by Filters beside Running, under the November 1 owner correction. The ALL tab is cash-only in the actual caller: `showsCash` and `showsTournaments` require mutually exclusive `gameSection` values. It has All/Running quick statuses and a sort-only sheet, with no irrelevant per-type controls. Its historical mixed-list branch does not make scheduled tournaments reachable from this family. Sorting offers Recommended, Stakes High To Low, Stakes Low To High and Most Players; MTT and Satellite sheets also offer Starting Time. Cash, Spins and SNG have no scheduled start and no misleading Starting Time choice. Satellite Starting Time orders scheduled MTTs by date; seat-first qualifiers have no scheduled timestamp and follow them within their availability tier. Legacy SPIN/SNG Starting Time preferences read as Players; all cash tabs (including ALL) read obsolete Starting Time as Recommended without an automatic remote rewrite. Fresh ALL opens Recommended.

Other audited controls: family open/close, every game tab, sheet game tabs, every accordion, Reset This Tab, Apply Filters, Close, Escape, backdrop close, sticky Filters, sticky Favorites, sticky Browse Game Types, direct price/player/status headings, static Game heading, and exact-start/countdown toggle. Reset leaves other tabs intact. Apply and every close preserve edits because selection saves immediately. The compact sticky bar reuses the actual owning handlers rather than maintaining a second filter store.

## Predicate and persistence contracts

- `rowPassesFilter`: games/formats/statuses/presets are OR within each field; separate fields intersect. Empty game/status/format selections mean unrestricted. Selecting all poker games is unrestricted. A full default price/seat range does not secretly narrow unknown or out-of-ladder rows.
- `ClubHomePage` passes tournament `game_type` before the subtype `variant`. Satellite discovery requires recorded format/target/type facts, never a title alone. Existing schedule/day/window predicates apply before saved filters.
- Statuses use actual lifecycle plus `tournamentEntryWindowOpen` and `matchesTournamentSubFilter`. Running includes a running event whose late entry is open; Open Registration includes Starting Soon. Occupancy uses real field capacity. Must-move cash games always offer seats, are never Full, and are Empty only when their whole game census is zero. Census excludes deleted rows, missing/closed lifecycle and non-live statuses.
- `featureState` keeps a row when its selected projection cannot answer, under Required and Exclude alike. **Unknown is not false.** Explicit null/false is evaluated using the engine's actual default where applicable. Selected columns own their values; legacy settings are fallback only when the column is absent.
- Cash RIT follows the actual engine permission expression `(run_it_twice && allow_run_it_twice) || run_it_twice_enabled`, its null defaults, and the two-seat table refusal. Insurance does not disable RIT: the engine sequences the run question before insurance. Bomb Pot requires its enabled switch and viable scheduled cadence; timed seconds and hand frequency are floored as in `BombPotScheduler`. Multi-Board also requires canonical board count, falling back to the legacy double-board flag only when absent/null. Auto Straddle requires Straddle enabled. Ante requires enabled terms and a positive amount. Time Bank null uses the engine's true default; an omitted projection stays unknown.
- Tournament trait functions read payout/purchase flags, guaranteed prize, recorded satellite facts, stored structure speed and ownership fields. Names are only the documented one-sided fallback when deciding columns are absent. No horse identity is filtered or exposed.
- `sanitizeStore` validates every list, including SNG format, removes duplicates/non-string keys and restores invalid numeric bounds without coercing null/booleans/empty strings into zero. Inverted ranges restore the full valid range. MTT reset defaults to all nine games and satellites excluded.
- Cache and remote rows are account/club scoped. `stageFilters` records intent immediately; debounced writes preserve ordering and unmount flush. Accepted remote hydration updates the board and cache without echoing a new write. A newer local edit outranks a late remote response. View preferences preserve per-tab explicit sorting and favorites.
- Sheet tab changes select the owning board before sort changes. `lobbySortBridge` maps Satellite price controls in both directions. Explicit page order is preserved for Starting Time and applicable Recommended modes; untouched Spins/SNG/Satellite defaults remain Players descending. Pins, favorites and availability tiers retain their existing precedence.

## Defects repaired and retained regression protection

| Defect                                                               | Repair / regression                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Sheet tab changed its form while sorting the previous board          | `onTypeChange` and parent synchronization; mounted sheet and real page tests                                              |
| Global Favorites silently narrowed tournament lists without a switch | Favorites control on all non-ALL tabs; mounted cash-to-MTT undo test                                                      |
| Satellite subtype overrode poker game in partial game selection      | Authoritative `game_type` first; actual caller fixture includes NLH/PLO satellites                                        |
| Malformed format/numeric remote values survived validation           | Sanitizer regressions failed before repair and pass afterward                                                             |
| New remote filters appeared in sheet but disappeared on close        | Hydration updates cache and board; mounted regression failed before repair                                                |
| Starting Time cash choice actually sorted by players                 | Removed irrelevant cash choice and normalized saved legacy reads                                                          |
| Satellite price chips reset to Players                               | Bridge price mapping plus real tournament-entry price tests                                                               |
| Explicit page sorting was overridden by default heading/phase order  | `preferPageOrder` with real SPIN/SNG/SAT/MTT board regressions                                                            |
| Dormant/disabled cash rule flags falsely matched Required filters    | Effective engine predicates and authoritative-column precedence; all five new cash regression groups failed before repair |

Focused files: `lobbyFiltersCrossDevice.test.ts`, `lobbyFilterSheetControls.test.tsx`, `clubHomeTaglineAndWizardClose.phase2.test.tsx`, `lobbySortSheetDrivesTheBoard.test.tsx`, `lobbyCashFeaturePredicates.test.ts`, `advancedFilterSpec.test.ts`, `tournamentDiscoveryFilters.test.ts`. Existing feature assertions remain; Bomb Pot fixtures now include the viable cadence they assert.

## Closed live E2E mapping

Maintained proof: `tests/e2e/production-lobby-filter-audit.spec.ts`, through the existing lobby UI proof workflow and validator. Exact cases:

1. `every HOLDEM lobby filter matches live rows and persists`
2. `every OMAHA lobby filter matches live rows and persists`
3. `every LIMIT lobby filter matches live rows and persists`
4. `every MTT lobby filter matches live rows and persists`
5. `every SPIN lobby filter matches live rows and persists`
6. `every SNG lobby filter matches live rows and persists`
7. `every SATELLITE lobby filter matches live rows and persists`
8. `sticky lobby controls and cross-tab sorting remain accessible and durable`
9. `live spectator player names stay complete on one line inside their plates`

The seven tab cases exercise each actual game/format/style/status/feature button in both directions, price presets and manual thumbs, table size, combinations, accordion state, sort results, quick controls, Apply/Close, acknowledged preference writes and reload readback. Expected cohorts derive independently from actual source responses, with realtime updates incorporated. The shared case covers sticky geometry, Favorites and undo, cross-tab per-game sorting, all close paths, exact time access, a real long-countdown witness, direct headings and ALL cash controls. Participation writes are blocked and must remain absent. Account cleanup, published identity and exact case/retry/skip requirements remain enforced by the existing hosted proof route. Live result: **pending**.

The ALL Most Players source originally compared one table while its card printed a whole-game count. `cashBoardComparator` now accepts an optional count accessor; ClubHomePage precomputes the existing cashEntry display projection once per row, including Lightning pool figures. Two real mounted caller regressions failed before and passed after (Main 1 has one player but game total twenty, or Lightning pool thirty, versus a five-player Main 1/game total eight). The shared live case checks all four ALL sort choices against actual whole-game values and confirms the full cash cohort is preserved. Running matches raw lifecycle RUNNING/IN_PROGRESS; it is not a nonzero-occupancy alias.

The first live run 41339809042 did not pass. Its account cleanup verified true. It identified the Seats Available glass overflow and independent-oracle lifecycle gaps, repaired in follow-up source. Latest owner corrections require white game copy, a larger clear bounty emblem, Filters beside Running without duplicate Favorites, and fitted single-line actual table names. The fixed nine-case live certificate remains pending publication and successful hosted execution.
