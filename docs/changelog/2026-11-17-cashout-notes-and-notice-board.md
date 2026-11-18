# Cashout Notes And Notice Board Escalation

Player cashout entry points preserve a multiline Note For Agent in the existing canonical request and operation identity. Both forms allow up to 2,000 characters; service and prepared-operation validation reject oversized notes without truncating the accepted intent.

Assigned agents can send the original pending cashout to the club Notice Board. The queue reads authoritative decision and escalation capabilities from `fn_cashout_queue_v2`; escalation uses `fn_cashout_escalate_v2` with a stable actor/club/request operation identity. Repeat taps, uncertain responses, account changes and stale queue generations do not create another cashout or hold. Board events refresh capabilities, and private access-revocation events clear the queue immediately.

Escalated requests show manager-only decisions and the club bank destination. The receipt verifier accepts that destination only with the explicit bank discriminator, owner/co-owner/admin actor, matching club treasury ledger destination and matching canonical bank balances. Private cashout receipts and their existing recovery behavior remain unchanged. The database migration must be installed before this client publishes.

Validation: focused actual-component and strict-receipt tests cover notes, escalation duplicates, cross-session capability changes, revocation, bank receipt mismatches and original financial acknowledgment. A local 393px browser fixture renders the actual modal and agent panel with synthetic transport, including multiline notes and escalation. No production financial writes are used for verification. Publication and live proof are recorded separately in the owning task checkpoint.
