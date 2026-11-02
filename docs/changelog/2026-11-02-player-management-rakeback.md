# Player Management Rakeback

Player rows show effective own-play rakeback in Simple and Advanced modes. The existing page RPC resolves terms through fn_player_rakeback_rate only for the visible page and financial-authorized rows, using each membership’s management club. No rates, commissions, hierarchies or payouts are changed.

Missing or malformed rates display Unavailable, never zero. Zero and fractional percentages remain accurate. Financial terms are removed from the identity-only session cache. Native PostgreSQL regression covers pagination, privacy and effective-rate delegation; client tests cover numeric strings, zero, fractional rates and cache redaction.
