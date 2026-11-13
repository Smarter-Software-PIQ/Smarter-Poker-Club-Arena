# The Ledger's MinRatio Comment Says What The Audit Does

The doc comment on `LedgerEntry.minRatio` in `HorseDataLedger.ts` said that a receipt with no floor still has "a zero against a big denominator" reported. The receipt audit (`fn_audit_data_receipts`) does not do that: it judges only rows that carry a `min_ratio` and raises nothing for the rest, a zero included. The comment now says so, and says a floor is written only from a measured live day.

Comment only. No ledger row, counter, decision or audit behaviour changes. Found by the independent review of #10668.
