# tests/owner-alert-antiflap-and-entity-context.law.test.ts

Enforces uniform anti-flap dampening across all `ca_owner_page_state` alert kinds (6-hour minimum cooldown once a kind pages >= 3 times in a rolling 24-hour window) and actionable entity context (`table_id`, `tournament_id`, `pages_in_24h`) on owner problem notifications while preserving the strict firing-only owner page gate.
