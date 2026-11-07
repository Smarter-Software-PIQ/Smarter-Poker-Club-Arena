# Club Data reads attributed identities before numeric facts

The initial fourteen-day screen failed with SQLSTATE 57014 while reading the current running-tournament list and previous-period summary. The existing attribution view filtered most Kings Club rows only after reading their numeric heap tuples.

A private, invoker-only window reader applies the exact existing view projection to indexed identity keys first. It retains the original source club in each raw primary key, then fetches the numeric facts only for eligible rows. The Kings screen's eight existing reads use that reader; other scopes retain the existing view and game-key predicate pushdown. authorization, date normalization, filters, aggregates, response shape and attribution policy remain unchanged. No indexes, persistent facts, ledger or engine behavior change.

Read-only production query counterfactuals executed the full screen body with the replacement query under the existing eight-second limit: current fourteen days 1,609 ms, previous fourteen days 1,615 ms. These are query measurements before installation, not live delivery proof.

The existing required native Club Data runner verifies the exact production preimage, unchanged full screens for owners/downlines/unions/ordinary clubs and filters, bidirectional EXCEPT ALL parity across current and previous windows, reassignment, retired and missing profiles, duplicate source identities, installer and drift refusal, rollback, replay refusal and private-helper access denial. Invocation-clock fields are normalized only when equal to generated_at.
