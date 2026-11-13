# Omaha Tournament First-In: Phase 2 Hardening (2026-11-13)

## Guard

A league arm that passed a partial parameter object (for example `{ bigBlindClosingShare: 0 }`, or `{}`) replaced the whole parameter set, so every share became undefined and the rule switched off without a trace. This happened during the R4 evaluation. HorsePreflop now merges a given object over the published defaults, and `HorseDecideOpts.omahaTournamentFirstIn` accepts a partial object. Law: a one-parameter arm and an empty arm play exactly as the default (fails on the earlier code).

## Law Coverage Added (Review Notes On #10687 And #10717)

- The tournament utility arbiter (Phase 7) evaluates and owns the widened heads-up big blind call in PLO4, PLO5 and PLO6 (was PLO4 only).
- End to end: a three-handed winner-take-all spin big blind closing against one raise calls where the engine folded, and Phase 7 owns it (PLO4, PLO6); the same spot with pay jumps keeps the engine folds.
- The law fixture's winner-take-all context is now a valid one (one place paid, payouts [100]); the earlier [100, 0, 0] made Phase 7 refuse it as invalid input in the three-handed cases.

No behavior change in production: production never passes a parameter object.
