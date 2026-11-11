# Acquire the opening tournament clock after early table creation

Tournament tables may become watchable with a RUNNING row before the first
deal records `started_at` and `level_started_at`. The HUD previously treated
that row as having no deadline, leaving the full level duration displayed
until its five-minute safety read. The opening level index does not change
when the anchors arrive.

The existing bounded start catch-up now also covers a RUNNING row missing
either clock anchor. It reads the authoritative row after scheduled start
and then resumes the normal level countdown. No new poll, engine behavior,
gameplay action or blind duration is introduced.

Three focused cases reproduce the failure before the change and pass after
it: both anchors absent, only the level anchor absent, and only the start
anchor absent. The full tournament HUD suite passes 57 cases, including
reconnect, owner cleanup, bounded reads and stale response handling.
