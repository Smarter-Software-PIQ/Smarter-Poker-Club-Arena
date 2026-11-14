# The engine writes a reduced guarantee as the exact figure

`reducedGuaranteeCopy` (server/src/services/TournamentGuaranteePolicy.ts)
rewrites the guarantee in a freshly spawned event's name and descriptions when
the November reduction applies. It wrote the new amount abbreviated ("2.5K GTD",
"Nightly 5K"). Under Dan's 2026-11-13 rule it now writes the exact figure with
separators ("2,500 GTD", "Nightly 5,000", "125.5 Chip Guarantee").

It still recognises every way an authored schedule name writes the old amount
("5K", "5,000", "5000"), never touches a figure that is not this guarantee (a
comma now also blocks a partial match inside "1,500"), and leaves a name alone
when the amount does not change. Authored schedule copy ("20K Stack") is owner
text and is unchanged; the satellite lookup still keys on the authored schedule
name and the schedule id (both untouched).

Safe for the name-keyed paths: spawns de-duplicate by spawn key per instance,
the restart guard compares an event's own name, and the lobby's compact title
already strips a separated figure ("- 2,500 GTD"), pinned in
`tests/unit/lobbyMttTitle.test.ts`.

Engine change: reaches production through the 04:00 America/Chicago daily
engine release (CLAUDE.md section 13). Events spawned before the cutover keep
the label they were created with.
