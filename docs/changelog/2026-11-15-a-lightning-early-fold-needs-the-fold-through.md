# A Lightning early fold needs the fold-through (default off)

**What it is.** A Lightning Horse is asked an early look off its turn, priced on the table as it stands
while seats before it still have to act, and a fold there is final. The beyond-big-blind probe
(development seeds, all-Horse tables) measured the same policy, asked on the real turn, continuing where
that fold had been final: small blind 2.9 / 10.3 / 8.3 VPIP points (NLH / PLO4 / PLO5), button
0.7 / 2.2 / 1.8, flop and turn 0.5 to 2 continuation points.

New decision option `lightningEarlyFoldNeedsFoldThrough` (HorseDecideOpts, ledger flag of the same name,
**default OFF**). On, in Lightning cash before the river: a fold to a decision asked while live seats before
the Horse still have to act stands only if the same policy also folds on the fold-through frame (those seats
folded; public state and the Horse's own cards only; the frame is never learned by the opponent model).
Otherwise the frame's answer is returned and the Lightning host, as for any early look that does not fold,
lets the Horse decide afresh on its own turn. No effect at the Horse's own turn, on the river, outside
Lightning or in tournaments. Nothing in the Lightning host, Classic or tournament paths changed.

**Switching it.** It is read by the brain and is a registered option of the Horse option switch (the
every-option registry and its follow-up list migration name the flag), so the live switch passes it to the
worker's decisions. With no switch row, or an `off` row, it is off everywhere. The league cannot measure it (no early look): see
`UNMEASURABLE_MATCHUPS` `nlh_lightning_early_fold_needs_fold_through` (0 of 2,000 pairs diverged).

**The frame ask is a side ask (2026-11-16, independent review).** It runs with telemetry suspended: it fires
no brain receipt, leaves no style record on the decision (the first ask's records are kept), and a failure in
it is reported as `HorseLogic.lightning_fold_through_frame_threw`, not as `HorseLogic.decide_threw` or
`phase15_brain_exception`. A frame ask that fails or is answered by the safety net, and a state the frame
cannot be built from, keep the early fold (the option-off answer). Only `lightning_fold_through_kept` and
`lightning_fold_through_released` are counted for it.

**Known limits (independent review of 2026-11-16).** All four need an option on; with the options off nothing here applies.

- The durable shown-river record has no speed key. With `lightningStyleReadSeparate` and `styleLongShownMemory` both on, the long shown river merge can bring a Classic showdown into the Lightning read.
- `HorseMind.omahaFacingBetEvReadOf` (option `omahaFacingBetEv`) still reads the pooled size map on a Lightning decision, also with `lightningStyleReadSeparate` on.
- The fold-through frame keeps the original turn owner (`currentPlayerSeat`), so it is close to, but not exactly, the question of the real turn (a rule that reads "it is my turn" stays out on the frame as on the early look). The frame ask also draws its own strength jitter, so a hand within jitter of a bar can still fold early.
- On a released early-fold answer, the decision object retains the first (fold) ask's style records, and the frame ask's style-read elapsed time still contributes to `takeStyleReadMs`.
- The `style_lightning_separate_*` receipts fire where the read is computed, so they do not fire again when a decision takes the read from its per-decision memo: with the option on they count fresh reads.
