# Digest recognizes funded agent tracking statements

The six November 16 credit invoices have exact immutable weekly tracking bases.
Owner-approved PR #8729 changed credit lines to funded-wallet tracking on October
30; these statements do not provide spendable borrowed chips. The digest still
flagged every statement with the obsolete claim that all agents were prepaid.

The attention producer now checks the original agent and period, policy boundary,
shortfall arithmetic and statement amount. Expected tracking statements remain in
the historical invoice metric. Unsupported statements still warn; a source count
that disagrees with the recorded metric is explicitly incomplete. No invoice,
balance, original alert or historical metric is changed by the migration.

The existing native digest entrypoint reproduces the false warning, exercises the
whole changed function, and covers wrong amounts/periods, inactive policy, missing
evidence, unchanged source records and authority, and migration replay.
