# Promo Principal In Wallets And At Tables

The former lock subtracted every outstanding promo grant from the playing
wallet even while its principal was at a table. A wallet with 50 real chips
and another 50 promo chips on the felt consequently reported zero cashable.
An isolated PostgreSQL case reproduces that result before this change.

Each grant now holds allocations of its original principal. A buy-in or a
same-person agent/playing-wallet movement transfers those allocations and
retains the original amount, fee target and FIFO order. Agent promo grants
are recorded against the same user identity used by their actual ledger.
Each wallet's withdrawal guard considers only principal held in that wallet.
The club-bank return path remains available and releases returned principal.

The existing accepted-hand transaction retires lost cash-game principal once
and records the promo-funded contribution before its original rake consumer
runs. Admission and gameplay spend unrestricted cash first. Losses consume
only surviving principal after that cash is gone; subsequent own credits never
resurrect spent principal. Partial principal keeps its original full fee target.
Source-backed refunds reverse unfinished progress, while an earned completed
unlock is final. Withdrawals spend cashable profit first.
Cash fees use their original accepted hand's clock, retained independently of
the eight-day hand archive. Delayed posting cannot fill a later grant, and an
expired grant cannot pass its unearned target to a new gift. Expired wallet
principal cannot fund another entry while its original-fund return is pending;
own chips and unexpired gifts remain usable. The summary identifies expired
principal separately from active play-through targets.
Physical Lightning seat mappings remain authoritative. Table profit does not
create more principal. Deferred constraints require all places to sum to the
grant's remaining principal. Helpers are private to the original money owners.

Qualification includes native wallet/agent/seat transitions, a reproduction
of the old cashability result, full-grant FIFO unlocking, uncalled chips,
Lightning mapping, replay, refusal rollback, conservation and privileges.
The maintained full hand authority fixture also executes actual accepted
cash-hand settlement and replay. Both proofs run in the existing promo CI.
The actual current funding owners retain their original treasury-gift proof.
Their existing 69-source inventory guard advances only the exact changed
funding-body fingerprint; the real protected applier reproduces refusal of
the former stale pin and verifies atomic rollback, the preserved guard and ACL.

This installs only before programme activation and requires the daily window
for ledger triggers. Ticket/event finalization, fee exclusion consumers,
expiry, integrity holds and the remaining acceptance proof are separate
programme prerequisites. This change does not activate promo enforcement.
Activation also requires the serving engine to queue top-ups during accepted
hand settlement, preserving the original funding boundary.
