# tests/a-hand-settlement-rechecks-at-install.law.test.ts

A migration from 20261123120000 on that settles by hand through fn_ca_adjustment_under_10_9 declares `-- @already-made-whole-guard:` in its header and refuses when chip_ledger shows a competing credit after the triggering event, because the install can be hours after the proof (20261123002808 would have paid a member twice after his agent re-sent the chips by hand).
