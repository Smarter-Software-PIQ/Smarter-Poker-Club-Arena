# Equal-share retirement retains the original mystery bounty history

The fixed recovery cohort contains one chests-only mystery event with 78
already-eliminated players whose `chips=0` and `current_bounty=12`. At
2026-11-01 17:42:56 UTC, event `16761305-83ad-4282-be72-5b9cb2dd88bc` remained
in the pending mystery phase with `mystery_bounty_regular_pool_percent=0`,
no bounty obligations, collections or payments, and its bounty bank intact.
The three earned place obligations totaled 253.10 and were fully paid.

This is the installed October 22 business rule, not evidence of unpaid cash
heads: the claim path records pre-activation chests-only busts without bounty
obligations and leaves their heads in the pool. The installed claim definition
contains `mystery_bounties_start_in_the_money` (MD5
`7b4725dcb4a512ba8e22addaaecf079e`). The engine's matching no-obligation branch
does not collect these heads. Ordinary bounty, legacy half-pool and active
mystery events do not qualify for this exception.

The original equal-share function retired only non-eliminated rows, then
required every row to have zero bounty. That made this valid historical shape
fail with `equal_share_roster_retirement_incomplete`. The follow-up migration
requires the exact original function preimage and clears only finite positive
head caches on already-eliminated, zero-chip players in a pending, non-PKO,
chests-only mystery event. Original elimination time, sequence, position,
prizes and winnings remain unchanged. The receipt retains the complete original
roster. Existing earned-obligation, quiescence, original-hand, bank, fee and
immutable receipt checks remain intact. No production rows are changed by
installation; the correction runs only inside the original explicit settlement.

The existing native equal-share qualification now reproduces the 78-row refusal
before installation, tests legacy/active/non-mystery/PKO and positive/null chip
refusals, refuses an unpaid earned claim, and verifies original historical rows.
Its real monetary doors continue to prove preview rollback, wallet conservation,
prior awards, fees, concurrency and same-operation replay. The required abort
entrypoint enforces all 65 cases. Final native run 05 passed, including the exact
live-proof/ACL expression and consistently bound review hashes, with settler MD5
`ef3c8122a5fccc4f90630c1672080240`; the other financial authority hashes were
unchanged. The private cluster stopped and was removed. Protected delivery and
installation status remain tracked in the central four-format audit checkpoint.
Source qualification is not production settlement.

The existing 04247 and 05048 migration bytes are unchanged. This follow-up is
installed only after their owning release establishes the prerequisite source.
The original engine chat retains deployment ownership and the audit parent
retains financial execution. No migration installation or financial mutation
was performed during this source work.
