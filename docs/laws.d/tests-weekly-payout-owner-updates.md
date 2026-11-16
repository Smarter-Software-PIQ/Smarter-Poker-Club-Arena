# tests/weekly-payout-owner-updates.law.test.ts

The weekly payout owner updates and statement-vs-Club-Data check (20261115205037) only add new objects and only read the payout: no existing function, trigger, cron job or table is modified, replaced or wrapped, no public table is written except through fn_raise_notification and fn_record_operational_alert, it runs on its own cron job with a 20 s statement and 1 s lock limit and its own advisory key, does nothing outside the 24 hours after the Monday run time, and no client role can execute it.
