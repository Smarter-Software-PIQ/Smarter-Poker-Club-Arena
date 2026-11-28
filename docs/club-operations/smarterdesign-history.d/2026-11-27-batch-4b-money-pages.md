## Batch 4b: the money pages, one full pass

| #   | Surface           | File                                                | What changed                                                                                                                                                                                                                                                       |
| --- | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 15  | Financials        | `src/pages/ClubFinancialsPage.tsx`                  | All ten frames, `ClubFinancialDashboard`, `RakeReports` and `ChipStatement` in chrome cases (the last two by an opt-in arena prop, so the Cashier Rake Treasury dialog and wallet pages keep painted); `DynamicWallet` in a chrome case with its approved row art. |
| 16  | Diamond Wheel ops | `src/pages/club/ClubWheelOperationsPage.tsx`        | Every section in a chrome case, `DiamondGamesMoney`, Daily Diamond Statements and Owner Agreement included; the 640px column kept.                                                                                                                                 |
| 17  | Diamond Games ops | `src/pages/club/ClubDiamondGamesOperationsPage.tsx` | Same pass on the shared sheet; the player-facing game pages that share `diamondGames.module.css` are untouched.                                                                                                                                                    |

Every printed figure and data hook on these pages was pinned against the old
painted components first with `tests/helpers/moneyFigures.ts` and is unchanged
(PR #12304, merge `f3a649b62`).
