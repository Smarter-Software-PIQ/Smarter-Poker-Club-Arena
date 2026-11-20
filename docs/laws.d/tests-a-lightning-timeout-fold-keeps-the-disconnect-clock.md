# tests/a-lightning-timeout-fold-keeps-the-disconnect-clock.law.test.ts

fn_lightning_fast_fold only clears disconnected_at on explicit fast or fold_watch taps, never on normal/timeout forced-folds.
