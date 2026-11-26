# tests/weekly-prep-waits-for-the-closed-week-cash.law.test.ts

`smarter_private.weekly_prep_shard` does not prepare a closed week until `weekly_closed_week_cash_settled` is true (the rakeback settler's keyset cursor is past every positive cash rake record of the week and no source of the week waits in the blocked retry queue), with a fallback one hour before the payout, and the cash-funding and own-agent admissions drop only the source's own 2-hour counts / 6-hour tq split part plus the whole-week aggregates instead of the club's whole week.
