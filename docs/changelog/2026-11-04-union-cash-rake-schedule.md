# Midway cash schedule and weekly rake budget, November 4, 2026

The owner requests far fewer cash games, especially 04:00-08:00 America/Chicago, and a union cash-rake total substantially below 200,000 per week. Both NLH and PLO must run throughout the day. Higher stakes remain authorized during limited prime-time windows; outside a game's slot Horses may play higher stakes only while a human is playing at that same table. This is not a global human-presence requirement for lower stakes.

## Measured baseline

Read-only production evidence covers Midway Union fade0000-0000-0000-0000-000000000001. Cash rake is the sum of rake_records.rake_amount, excluding tournament flags/IDs and Spins tables, scoped through the recorded club's union. Separate BBJ contributions are excluded; gross rake is not reduced by rakeback. One recent-hour reconciliation found 6,019 distinct cash hands and 8,721.44 rake in both rake_records and hand_history, with no missing or differing hand records.

The completed Chicago calendar week October 26-November 2 generated 1,540,366.21 cash rake. Keeping 40% of that same game mix would still generate about 616,146.48. The seven full local days October 28-November 4 generated 1,149,981.00: Lightning contributed 838,741.34 (72.94%), Classic 311,239.66. DST makes that history 169 elapsed hours. During its 28 hours between 04:00 and 08:00, 184,354.68 rake accrued; the average hourly count was 48.43 distinct tables with at least one raked hand, not an instantaneous concurrency measurement.

The owner's November 4 clarification applies the 200,000 weekly pace prospectively from deployment, including the remainder of this week. Rake earned before deployment is excluded from this adjustment's budget. There is no catch-up shutdown, deduction of already-earned rake from the remaining allowance, or ledger rewrite. Historical weeks provide rate evidence only.

Evidence and raw read-only queries are retained under /Volumes/SmarterArchives/agent-evidence/extreme-archive/union-cash-cap-01a1a67f. Table classification uses current catalog metadata, not a complete historical catalog reconstruction.

## Maintained schedule

All hours are America/Chicago, DST aware. Friday and Saturday use the weekend window. A slot authorizes one selected Main 1 table of the named game, not every feeder/main in its cluster. Duplicate Main 1 numbering selects one stable table ID. Existing excess seats leave through the normal engine leave/settlement path, so transitions can extend through an in-flight hand.

| Local time                               | Scheduled tables | Mix                                                                       |
| ---------------------------------------- | ---------------: | ------------------------------------------------------------------------- |
| 00:00-08:00, every day                   |                3 | NLH .10/.25, NLH .25/.50, PLO4 .10/.25                                    |
| 08:00-12:00                              |                8 | Add PLO4 .25/.50, PLO5 .10/.25, PLO6 .10/.25, FLH and FLO8 .25/.50 blinds |
| 12:00 until prime time                   |               10 | Add NLH .50/1 and PLO4 .50/1                                              |
| Sun-Thu 18:00-23:00; Fri-Sat 17:00-24:00 |               16 | Add NLH/PLO4/PLO5/PLO6 1/2 and two fixed-limit slots                      |
| Sun-Thu 23:00-24:00                      |               10 | Return to the afternoon floor                                             |

Fixed-limit slots are FLH/FLO8 1/2 blinds Sun-Thu 18:00-23:00 and Fri-Sat 17:00-19:00; 2/5 blinds Fri-Sat 19:00-21:00; 5/10 blinds Fri-Sat 21:00-24:00. The lobby displays the limit bet sizes as 2/4, 5/10 and 10/20 respectively. PLO4 1/2 uses the currently enabled Lightning game; all other scheduled slots are Classic, including the catalog's PLO5 Madness game. Other Lightning games receive no automatic Horse-only slot.

The higher-stakes human exception can support additional tables outside the baseline. It never overrides the current forbidden variants (pineapple, short deck/6+, PLO8) or authorized stake ceilings (NLH/PLO 1/2; FLH/FLO8 5/10 blinds). A waiting-list entry, spectator, sitting-out or departing human does not qualify. A zero stack alone does not disqualify a human who may be all-in. The exception is scoped to that table. Lower-stakes scheduled games still run with Horses alone. Unscheduled lower-stakes tables get no scheduled Horse staffing. Humans retain their own admission and table access.

## Rake model

Forecasts use measured gross rake per active table-hour by Classic/Lightning mode, variant and actual blinds. The elevated-rate scenario uses the observed 90th percentile among table-hour bins spanning at least 50 minutes. This percentile is not a statistical confidence bound or guaranteed maximum. An ordinary week authorizes 1,466 table-hours (8.73 average scheduled tables), compared with 8,601 active table-hour bins in the historical 169-hour period.

| Scheduled game (actual blinds)          | Hours/week | Mean-rate estimate | Elevated-rate scenario |
| --------------------------------------- | ---------: | -----------------: | ---------------------: |
| Classic NLH .10/.25                     |        168 |           1,819.44 |               2,392.32 |
| Classic NLH .25/.50                     |        168 |           3,633.84 |               4,722.48 |
| Classic PLO4 .10/.25                    |        168 |           2,694.72 |               3,501.12 |
| Classic PLO4 .25/.50                    |        112 |           3,581.76 |               4,803.68 |
| Classic PLO5 .10/.25                    |        112 |           2,522.24 |               3,402.56 |
| Classic PLO6 .10/.25                    |        112 |           2,489.76 |               3,405.92 |
| Classic FLH .25/.50 blinds              |        112 |           2,024.96 |               2,673.44 |
| Classic FLO8 .25/.50 blinds             |        112 |           2,844.80 |               4,343.36 |
| Classic NLH .50/1                       |         84 |           3,213.84 |               4,426.80 |
| Classic PLO4 .50/1                      |         84 |           5,059.32 |               6,652.80 |
| Classic NLH 1/2                         |         39 |           3,120.00 |               4,512.30 |
| Lightning PLO4 1/2                      |         39 |          38,904.06 |              56,149.08 |
| Classic PLO5 1/2                        |         39 |           6,418.62 |               9,399.00 |
| Classic PLO6 1/2                        |         39 |           6,942.78 |               9,785.10 |
| Classic FLH 1/2 blinds                  |         29 |           2,459.49 |               2,921.75 |
| Classic FLO8 1/2 blinds                 |         29 |           2,015.79 |               2,433.10 |
| Classic FLH 2/5 blinds                  |          4 |             780.76 |                 918.00 |
| Classic FLO8 2/5 blinds                 |          4 |             690.12 |               1,250.40 |
| Classic FLH 5/10 blinds (extrapolated)  |          6 |           2,342.28 |               2,754.00 |
| Classic FLO8 5/10 blinds (extrapolated) |          6 |           2,070.36 |               3,751.20 |

Total scheduled estimate: **95,628.94**. Elevated-rate scenario: **134,198.41**. Adding **30,000** for extra human-supported demand and transition activity yields a planning scenario of **164,198.41**, leaving **35,801.59** below 200,000. The goal is comfortably below the ceiling; unused budget is not a reason to open more games.

Human-containing cash tables generated 19,288.66 during the same seven full days. That includes all rake at those tables, including Horses, and overlaps the scheduled games; it is not an extra measured human-only fee total. The 30,000 is a planning reserve, not a measured future amount. FLH/FLO8 5/10 blinds had no measured play and are explicitly estimated at twice the 2/5 rate. New fixed-limit samples are small; FLO8 2/5 has only three full-hour observations. Human demand can exceed the reserve, so a schedule preserving the human exception cannot guarantee a hard union-wide rake cap.

## Source and verification

Before this change, HorseCashSchedule enforced stakes/variants and a 0.2 activity scale, but did not prescribe which games or how many tables could be staffed. HorseFleetManager's admission pass around line 2895 and HorseSessionRotator's roster departure pass around line 1001 now use the same maintained game/hour policy. The fleet's existing complete seat read adds sitting-out/departing flags for the human exception. The existing rotator uses its complete profile/seat reads and the normal leaveTable door. No new timer, background repair service, fee, wallet, tournament, player profile, database migration, or table enable/disable mutation is introduced.

The existing 60% reduction remains in place. New tests cover every hour of the week, continuous NLH/PLO availability, overnight/prime transitions, DST, duplicate mains/feeders, human presence and forbidden-game precedence. Connected tests drive the real session rotator through normal leave calls for off-peak higher stakes, preserve playing humans, keep lower-stakes Horse-only games, and preserve prime-time higher-stakes Horse-only play.

The production noResolve emitter explicitly includes the new schedule JSON in `server/tsconfig.emit.json`; the existing build-resource guard verifies all imported runtime JSON is selected. A hosted preflight caught the initially omitted entry before any image was published, and the maintained emitter configuration was corrected without weakening that guard.

The fleet's alternate `claimOfferedSeats` path also checks the same schedule before sizing or purchasing a buy-in. Previously it checked surplus, disabled games and lifecycle but could answer an offer outside the new schedule. An isolated test of the real handler reproduced four forbidden admissions before the correction; the corrected handler preserves prime-time offers, both overnight game families and the playing-human exception while leaving refused offers and wallets untouched.

Status: source candidate; protected merge, engine publication and live verification remain required. Current deployed behavior must not be inferred from this document.

The remaining native qualification blocker exposed an unbounded wait in `operations/release/ci/fixture-smoke.py` around line 350: after terminating a timed-out process group, `communicate()` still waited indefinitely for pipes held by a detached descendant. Real isolated subprocesses reproduced both build and service hangs against the previous source. Cleanup now closes those readers, bounds direct-child reaping and preserves the original failure. Regression coverage also checks an already-exited group leader, bounded owner-only build diagnostics, and no private service output. The hosted job's missing logs do not prove this was its original stall; exact-candidate native CI remains required. No runtime, production credential, fee or release route changes accompany this qualification correction.
