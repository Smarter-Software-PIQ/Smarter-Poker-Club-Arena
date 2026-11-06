# Private PLO river opportunity appendix

Horse study batches can now generate a reusable per-decision PLO4/5/6/8 river appendix through `horse-study-report.py --river-opportunities` or the standalone private `horse_river_appendix.py` command. The appendix reuses evaluated own-hand/blocker facts and captured legal bounds, preserves exact rule context, binds source and output hashes, and refuses exposed directories, changed input or output overwrites.

Size diagnostics distinguish raise-to from incremental risk and state the matched-risk, zero-share, no-further-wager and no-cost assumptions explicitly. Short calls, later actors, side pots, split-low sharing, response dependence and tournament utility remain unpriced. No actual action is labeled a bluff; no response probability, optimal action or activation is generated. Private supplemental low certificates are not bundled or silently rebound.

Seven focused cases cover incremental raise risk, short-call/all-in limitations, sitting-out eligibility, context and unknown preservation, outcome isolation, private CLI input integrity and the maintained study report attachment path. They are discovered by the existing `horseHumanStudy.test.ts` Python suite; its exact discovery command passes all83 cases on this source. No runtime policy or production behavior changes.
