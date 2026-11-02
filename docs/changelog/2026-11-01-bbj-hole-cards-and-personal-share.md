# BBJ Hole Cards And Personal Award

The jackpot history retains the full Total Paid Out headline and now places the jackpot winner's own recorded +award beside their name. Both sides of the hand comparison show explicitly labeled dealt Hole Cards separately from the five-card made hand. Hold'em and four-, five- and six-card Omaha retain every dealt card. Missing cards or personal amounts remain unavailable rather than being inferred from the board or event total.

Uses the existing fn_bbj_recent_hits payload in the shared modal/page history. No payout, schema, API, engine, pagination, realtime or drilldown change. Regression tests cover both jackpot kinds, raw card identity/count, unavailable cards, invalid personal shares and recorded zero. Mobile layouts are verified with real components.
