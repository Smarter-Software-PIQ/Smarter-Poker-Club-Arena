# Owner closes the Midnight Free Buy outside quiet hours (2026-11-05)

Dan, 15:04 Chicago: "OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT FREE BUY AND RETIRE DIAMOND ARENA NOW".

Diamond Arena's last unfinished event, Midnight Free Buy (NLH) `6429087f`, was stuck since
2026-10-29 (37 seats holding chips on 5 open tables, 11,200 prize pool) and is owner-recorded
for retirement. Its 170 entrant rows put it over the 50-account bulk-closure limit, which only
admits such closures 04:00-06:00 Chicago.

Migration `20261105210545` waives exactly that one refusal reason for exactly one call:
`owner_retire` of that one event, until 2026-11-06 10:00 UTC. The break window, maintenance,
resume-settling and statement-timeout refusals still apply. The waiver expires on its own.
