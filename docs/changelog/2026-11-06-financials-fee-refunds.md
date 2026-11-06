# Financials preserves tournament fee refunds

Financials rejected an otherwise valid report when a day contained net tournament fee refunds. The reporting producer records cancellation reversals as signed fees on their posting day; the client now preserves those signed daily and window totals. Finite whole-cent validation, daily-total reconciliation, net-revenue reconciliation and unrelated nonnegative checks remain enforced.

Focused regressions cover mixed positive/refund days, net-negative windows, invalid signed amounts and the actual Financials page consuming the verified snapshot. No financial records or balances change.
