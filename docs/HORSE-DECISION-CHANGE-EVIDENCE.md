# Evidence A Horse Decision Change Needs Before It Is On By Default

Written 2026-11-13 after the PLO6 audit. Two of its three decision changes were merged on a demonstrated mechanism alone and had to be switched to opt-in a few hours later (#10626, #10628). This is the checklist that would have caught both. It applies to any change that makes a Horse choose a different action. It does not apply to telemetry, tests or replay tooling.

## The Rule

A decision change may be merged as an opt-in arm (option read as `=== true`, off in production) with a mechanism and a regression. It is turned on by default only when every row below is in the pull request body or linked from it.

| #   | Evidence       | What Counts                                                                                                                                                                              | What Does Not                                                                                                                                                                |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mechanism      | The exact code path, with the values at a real node                                                                                                                                      | "The action looks wrong"                                                                                                                                                     |
| 2   | Input fidelity | A statement that the replay used carries every input the live decision reads at that node, or a list of what was supplied by hand                                                        | A reconstructed replay taken at face value. Recorded public nodes do not carry the table's VPIP floor, its window, the seat's judged VPIP, opponent reads or the second look |
| 3   | Value          | Expected value of the new action against the old one at each changed node, under at least three stated opponent ranges, one of them value-only, with the sign and its sensitivity stated | A mechanism. A single favourable range. An aggregate with no per-node table                                                                                                  |
| 4   | Continuation   | Where the argument depends on what happens next (a re-raise, an overcall, a fold), that frequency measured from recorded hands                                                           | An assumed frequency                                                                                                                                                         |
| 5   | Reach          | How many decisions change, measured with the inputs of row 2 in place, and how many of those were already that action in production                                                      | A count from an unfloored or memory-off replay alone                                                                                                                         |
| 6   | Scope          | Every variant and format the code path reaches, with a decision-level case for each, or an explicit gate that excludes it                                                                | "Omaha" as a scope when the evidence is PLO6 cash                                                                                                                            |
| 7   | Visibility     | A telemetry receipt on the changed path, registered in the ledger                                                                                                                        | Nothing to count after release                                                                                                                                               |
| 8   | Limits         | What the evidence cannot show, in the pull request body                                                                                                                                  | Silence                                                                                                                                                                      |

## Reading The Value Row

- A change that is positive under some ranges and negative under others is not supported. It can ship as an opt-in arm.
- Simulated totals are not production gains. Say so.
- Results of the hands themselves are not evidence about the decisions.

## If A Change Is Already On And A Row Fails

Switch it to opt-in in its own pull request, keep the code and the regression as the arm, and retire any law that promised the default behaviour in the same pull request, following docs/LAWS.md rule 4 for how a law is retired. Tell the release custodian which commits carry it on. Do not describe one release of unsupported behaviour as acceptable, and do not assume a later release repairs it.
