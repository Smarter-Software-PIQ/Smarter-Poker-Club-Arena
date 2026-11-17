# Release certificate reads the installed Pacific fee contract

The production agent-boundary qualifier still required `UTC` after migration
`20261116163311` moved personal fees to `America/Los_Angeles 00:00`. It rejected
the correct installed reader before the private template fixture could be
prepared, causing later notification and table-management proofs to lack their
required club.

The qualifier now requires the exact Pacific day metadata. All zero-balance,
rank, privacy, forbidden-export and cleanup assertions remain enforced. The
maintained offline execution fixture covers all three agent ranks, rejects UTC,
unknown and missing day metadata, and verifies cleanup after each refusal. The
existing required unit suite executes that fixture.

The Pacific fixture fails against the former qualifier and passes after this
source correction. Production certification remains separate from local checks.
