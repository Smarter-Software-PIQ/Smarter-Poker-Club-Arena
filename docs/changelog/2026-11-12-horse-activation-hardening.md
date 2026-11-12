# Horse Upgrade Activation: A Dark Upgrade Is Reported The Next Morning

Follow-up hardening to `2026-11-12-horse-upgrade-live-evidence.md`. That change put a counter on every enabled upgrade's path. This one makes the existing daily audit judge them, closes the gaps an independent review left open, and states two things the health page and the counters implied but did not say. No decision, wager, think time, queue or deadline changes.

## The Daily Audit Now Judges The Per-Decision Upgrades

`upgrade01_action_line_posterior`, `upgrade02_card_removal_scored`, `upgrade06_public_timing_hint` and `upgrade11_indifference_pool` are registered in `HorseDataLedger.ts` with a floor against every live decision (`decide`). The existing receipt audit (`fn_audit_data_receipts`) therefore reports an enabled upgrade that fired zero times on a real day as critical, and one far below its floor as a warning; the existing drift audit (`fn_audit_layer_drift`) already reports a fall from a counter's own usual rate. No new database function.

The floors (0.05 percent, and 0.01 percent for the indifference pool) are tripwires for a dark layer, set far below any plausible share. They are not measured rates; the counters are not serving yet. They are to be revisited with the first full live day.

## Street Prewarm Refusals Are Counted

`upgrade05_prewarm_refused_seen` counts a prewarm that was asked for and not posted (the worker was busy, held or not ready, or the board was not a street). Beside the worker's `poker_horse_street_prewarm_total` it shows how often the idle-only rule leaves a street unwarmed. Evidence only; the rule is unchanged.

## Phase 14 Says Whether A Kernel Is Selected

Each Phase 14 domain in the activation manifest now carries `kernel: 'selected' | 'unselected'` beside `mode`, read from the protected release selections. Every domain is `unselected` today: a `candidate` mode is an admitted catalog, and with no kernel the corrective node returns the baseline. The manifest digest changes with this field; the engine and its workers compute it from the same source.

## The Guard Law Is Stricter

`HorseUpgradeLiveEvidence.law.test.ts` now reads source through a small lexer. A counter counts only when it is a string literal written in code inside the arguments of an emitting call, called bare or as `this.deps.<emitter>`. A block comment of any shape, a string that only quotes the call, and a like-named method on another object no longer satisfy it. Still out of reach of any source law: an emitting line in dead code.

## Behavioural Tests For The Four Counters That Had None

- `HorseUpgradeSideGameCounters.test.ts` (4): run-it-twice answers counted as `respondToRIT` later receives them, no human counted; kill-pot and seven-deuce context counted once at a real decision start, through a real engine and hand.
- `LightningUpgradeCounters.test.ts` (4): the stale pre-action purge on a real Lightning host, armed and unarmed; the seven-deuce counter in `decideLightningHorse`.
- Each of the six emitting lines fails a test when deleted.

Found while writing them: the Lightning host never sets `sevenDeuceEnabled` on a Horse turn, because Lightning does not offer the seven-deuce game. The Lightning seven-deuce counter is correct and cannot fire from the host today. That is the game not being offered, not a wiring gap; upgrade 08 on Lightning is not applicable until it is.

## Two Rules For A New Counter, Written Where They Are Needed

The `noteFire` doc comment in `BrainTelemetry.ts` and the ledger contract test's failure message now say it: register the key in the ledger, and end a counter whose quiet days are normal in `_seen`, or the drift audit reports those days as a layer that went silent.

## Comment Correction

`HorseTournamentPostflop.ts` said the 4 ms work budget and `operation_budget` are gone. That is true for Phase 8. Phase 13's pricing of its own proposals still carries a 4 ms clock and still reports `operation_budget`; the comment now says so. The clock itself is not changed here: it decides tournament actions and belongs to the tournament strategy owner.
