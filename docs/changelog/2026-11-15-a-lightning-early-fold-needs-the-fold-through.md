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

**Switching it.** It is read by the brain, so it becomes switchable live through the Horse option switch
once the every-option registry is on main and its follow-up migration lists the flag. Until then nothing
passes it and it is off everywhere. The league cannot measure it (no early look): see
`UNMEASURABLE_MATCHUPS` `nlh_lightning_early_fold_needs_fold_through` (0 of 2,000 pairs diverged).
