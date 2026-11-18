# Horse Upgrade Activation: A Dark Upgrade Is Reported The Next Morning

Follow-up hardening to `2026-11-12-horse-upgrade-live-evidence.md`. That change put a counter on every enabled upgrade's path. This one makes the existing daily audit judge them, closes the gaps an independent review left open, and makes the corrective kernel's reach countable. No decision, wager, think time, queue or deadline changes.

## The Daily Audit Now Judges The Per-Decision Upgrades

`upgrade01_action_line_posterior`, `upgrade02_card_removal_scored` and `upgrade06_public_timing_hint` are registered in `HorseDataLedger.ts` with a floor against every live decision (`decide`). The existing receipt audit (`fn_audit_data_receipts`) therefore reports an enabled upgrade that fired zero times on a real day as critical, and one far below its floor as a warning; the existing drift audit (`fn_audit_layer_drift`) already reports a fall from a counter's own usual rate. No new database function.

The floors (0.05 percent) are tripwires for a dark layer, set far below any plausible share. They are not measured rates; the counters are not serving yet. They are to be revisited with the first full live day. Upgrade 11 carries no floor yet: independent review showed that on a Hold'em-only day its pool counter depends on rare spot classes, so a floor there could raise a false alarm until a live day is measured. Upgrade 10 has none because it counts read computations.

## Street Prewarm Refusals Are Counted

`upgrade05_prewarm_refused_seen` counts a prewarm that was asked for and not posted (the worker was busy, held or not ready, or the board was not a street). Beside the worker's `poker_horse_street_prewarm_total` it shows how often the idle-only rule leaves a street unwarmed. Evidence only; the rule is unchanged.

## Phase 14 Eligibility Is Counted

`phase14_kernel_eligible_seen` counts a FAST decision that reached the admitted corrective kernel: usable authority, candidate mode and a snapshot inside the kernel's declared family. For cash that family is narrow: exactly two dealt seats, a single-board river, the opponent all in. It is counted before the baseline exists; whether the baseline is a fold or call and whether a proposal is made are conditions of application, checked later. Applications were already counted at commit (`phase14_selection_*`, `phase14_execution_*`). Until now a day of zero applications could not be told apart from a day of zero eligible spots.

The activation manifest is unchanged. Its `candidate` mode is accurate: on the thirteen admitted domains the kernel is live under the owner-forced activation and can replace a river fold or call at its 5 percent conditional probability.

## The Guard Law Is Stricter

`HorseUpgradeLiveEvidence.law.test.ts` now reads source through a small lexer. A counter counts only when it is a string literal written in code inside the arguments of an emitting call, called bare or as `this.deps.<emitter>`. A block comment of any shape, a string that only quotes the call, and a like-named method on another object no longer satisfy it. Still out of reach of any source law: an emitting line in dead code.

## Behavioural Tests For The Four Counters That Had None

- `HorseUpgradeSideGameCounters.test.ts` (4): run-it-twice answers counted as `respondToRIT` later receives them, no human counted; kill-pot and seven-deuce context counted once at a real decision start, through a real engine and hand.
- `LightningUpgradeCounters.test.ts` (4): the stale pre-action purge on a real Lightning host, armed and unarmed; the seven-deuce counter in `decideLightningHorse`.
- Each emitting line (five here, and the prewarm refusal) fails a test when deleted.

Found while writing them: the Lightning host never sets `sevenDeuceEnabled` on a Horse turn, because Lightning does not offer the seven-deuce game. The Lightning seven-deuce counter is correct and cannot fire from the host today. That is the game not being offered, not a wiring gap; upgrade 08 on Lightning is not applicable until it is.

## Two Rules For A New Counter, Written Where They Are Needed

The `noteFire` doc comment in `BrainTelemetry.ts` and the ledger contract test's failure message now say it: register the key in the ledger, and end a counter whose quiet days are normal in `_seen`, or the drift audit reports those days as a layer that went silent.

## Comment Correction

`HorseTournamentPostflop.ts` said the 4 ms work budget and `operation_budget` are gone. That is true for Phase 8. Phase 13's pricing of its own proposals still carries a 4 ms clock and still reports `operation_budget`; the comment now says so. The clock itself is not changed here: it decides tournament actions and belongs to the tournament strategy owner.
