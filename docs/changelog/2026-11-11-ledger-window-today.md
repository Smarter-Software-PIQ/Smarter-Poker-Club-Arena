# Ledger Window Starts On Today

The member Player Record now opens with Select active and both dates set to the current America/Chicago calendar day. Its first ledger request uses that same day. Range selections and drafts remain local to the visit instead of reading or writing saved account preferences. Confirm, Overall, 7 Days and the Statistics range link retain their existing behavior during the visit.

Component regression covers old saved preferences, confirming historical dates, leaving and returning across Chicago midnight. Production certification checks confirmed custom dates reset after router navigation and reload. No database or engine change is required.
