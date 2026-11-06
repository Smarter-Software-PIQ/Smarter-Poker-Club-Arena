# Club Data Date Ranges And Player Totals

The Club Data date bar opens start/end calendar controls for up to 93 inclusive Chicago days, matching the reporting RPC's existing limit. Custom ranges stay fixed across midnight, arrows shift their full span, and the existing presets restore rolling windows.

Total Winnings, MTT Winnings and Fee open searchable, complete player totals for the exact date/game/stakes/search scope. The read-only RPC uses Chicago attributed facts and live cash seats, retains the existing authorization/downline rules, distinguishes finished MTTs, and exposes unassigned fees without inventing a player. Winning and losing player subtotals explain the net; fee amounts are fees generated, not commissions earned. The agent's separate My Fees Earned card retains its existing meaning.

Connected correction: the plain owner summary was still reading unadjusted per-game rollups for clubs whose player attribution changed. Kings Club on November 5 returned 4,280.07 in that path versus 423.84 in its attributed player facts. Those affected clubs now use the existing attributed-fact branch for the summary as their rows already do. Other clubs retain the optimized rollup. No financial records, balances or settlement rules change.

Regression coverage: custom date validation/DST/shift/presets; accessible actions; scope receipt validation; searchable complete totals and read-failure recovery; isolated PostgreSQL checks for owner/agent/refused access, complete sums, attribution, finished/running MTTs, cash felt, empty days and filters. Native coverage joins the existing Data Console PostgreSQL gate. Live installation/publication evidence is retained in the task checkpoint.

Required-gate correction: the existing weekly accounting page-evidence fixture randomly collided on club short ID 39595. Its three club-insertion sites now supply deterministic fixture-only IDs outside the random range, and the existing native regression asserts those IDs. Production defaults, uniqueness constraints and accounting assertions are unchanged. Exact source bindings are updated; the complete native weekly qualification passed.
