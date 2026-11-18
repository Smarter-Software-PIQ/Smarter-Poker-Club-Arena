# Exact Horse turn-clock receipts

Accepted Horse actions carry private clock evidence into the existing accepted-hand journal. The engine captures the actionable start and applicable deadline in milliseconds before controller acceptance, and takes acceptance time from the controller record. The receipt follows that record into its hand and action ordinal, preserving player, street and action origin.

Strategy actions, queued check/fold, other preactions, clock expiry and error fallbacks have separate receipt paths. Error fallbacks retain the worker refusal reason when available. Missing or recovered clock evidence stays absent. Clock extensions retain the actionable start, and a rejected queued preaction retains the start preceding its visible beat.

Focused acceptance, persistence and journal regressions cover the diagnostic path. Normal engine qualification, protected merge and sole-owner publication are required. Fresh natural production receipt verification is recorded in the existing task checkpoint.
