# tests/an-agent-cannot-lock-the-mac-out-of-production.law.test.ts

An agent cannot lock the Mac out of production (2026-11-08): failed logins to engine-01 tripped its fail2ban jail and banned the Ops Mac for 24 h. Every repo script, runbook and workflow ssh/scp/rsync to the engine (5.161.252.33) or Backup host (5.161.236.0) must be BatchMode=yes, IdentitiesOnly=yes with one -i key and a ConnectTimeout, or use the Mac's fail-closed aliases `ca-engine` / `ca-backup`; CLAUDE.md and AGENTS.md carry the rule.
