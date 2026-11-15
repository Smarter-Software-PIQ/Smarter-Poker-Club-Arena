# CHECKPOINT: Charles Rule countdown resumes where it left off

Owner rulings: 2026-11-13 23:04 and 23:40 America/Chicago (the countdown pauses
out of profit and resumes at the same number; the doubling baseline from
before the pause is kept). Status recorded 2026-11-14 14:46 UTC. This is a
shared record: the Lightning owner reuses the evidence below and updates only
the rows it proves.

## Delivered (accepted by the owner 2026-11-14 08:44 Chicago)

| Item                                                                   | Where                                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Pause/resume state machine (`fn_cash_session_evaluate`)                | #10788, migration `20261114050737`                                                                               |
| Resume law; custody-race midnight fix                                  | #10801                                                                                                           |
| Paused display (seat tracker, Lightning pill) and back-in-profit toast | #10804 (its owner keeps it)                                                                                      |
| Pause toast, Club Data `paused_rows`, law, test-harness repairs        | #10803 = `8e6e7e3bc`, migration `20261114072737`                                                                 |
| Live client                                                            | `ca_sha 8e6e7e3bc...` at both build-info URLs; live chunks carry the pause toast, resume toast and `paused_rows` |

## Live behaviour checklist

| Check                                                                    | Status                           | Evidence                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Club Data lists paused players without changing the owed list            | PASS                             | 2026-11-14 ~08:55 UTC, club `fade0000-...0001` read as its owner: 21 owed rows = 21 by direct count, row shape unchanged; 2 `paused_rows` (4/10, 1/10)                                                                                                             |
| Paused Classic sessions keep count and doubling reference; leave allowed | PASS                             | 2026-11-14 08:42 UTC: 10 paused Classic sessions, none lost `hr_hands_played` or `hr_reference_stack`, none refused by `fn_cash_leave_check`; player `af98ffbe` status 6/10 played, 0 owed, leave allowed                                                          |
| Doubled requirement survives a pause                                     | PASS                             | 14:46 UTC: paused with `hr_doubles = 1`, `hr_hands_required = 20` and reference kept: `e7b67b80` (Classic, 13/20), `101ea260` (Classic, 9/20), `f25f006b` (Lightning, 6/20). Doubles are judged only while counting, so a paused double was taken before the pause |
| Lightning count survives a pause                                         | PASS (evidence of survival only) | `c65c3f99` paused at 6/10 (07:20 UTC), closed while still paused at 6/10; 14:46 UTC: 8 more Lightning sessions paused with counts kept (e.g. `3db88d6a` 9/10, `f25f006b` 6/20)                                                                                     |
| Lightning pause-to-resume in one session, resuming from the kept count   | UNVERIFIED                       | Needs one session seen paused and later running with the same `hr_hands_played`. Candidates to re-read: `3db88d6a`, `f25f006b`, `3e54272a`, `7e76e5f0`                                                                                                             |
| Classic pause-to-resume from the kept count                              | PASS                             | 2026-11-14 ~06:30-06:42 UTC: `30d1442c` paused with 7 left, resumed and completed at exactly 10; `416ca801` paused with 2 left, completed after 2 more                                                                                                             |
| Classic on-screen paused countdown                                       | UNVERIFIED live                  | Real status rows decode to the paused count through the shipped parser; not watched rendering. #10804 display test passes                                                                                                                                          |
| Lightning on-screen paused countdown                                     | UNVERIFIED live                  | Same data path as Classic; not watched rendering                                                                                                                                                                                                                   |
| Pause toast once on a real transition                                    | UNVERIFIED live                  | `tests/charles-rule-pause-is-said-and-listed.law.test.tsx` passes; text in live chunk `hitAndRun-*`                                                                                                                                                                |
| No pause toast when opening an already-paused table                      | UNVERIFIED live                  | Same law test (pause standing at open is not announced)                                                                                                                                                                                                            |
| Back-in-profit toast                                                     | UNVERIFIED live                  | #10804 display test; text in live chunk                                                                                                                                                                                                                            |

No test bets: every live row above comes from existing session records or
naturally occurring play (CLAUDE.md 11.5). There is no history table for
`cash_player_session`, so a transition is proven only by re-reading the same
session later. No engine cutover is involved.
