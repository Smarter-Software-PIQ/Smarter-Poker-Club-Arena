# Horse attendance targets share the purchase transaction

Independent MTT discovery, creation and overlay passes calculated their own
shortfalls before purchasing entries. The existing acquisition lock serialized
each purchase, but the purchase API never received the intended attendance
target. Two passes could therefore spend the same stale shortfall. The native
regression reproduces two entries against a target of one before the correction.

## Maintained correction

`fn_register_horse_for_tournament_to_target` is a service-only input door. It
takes the existing acquisition lock and counts the actual registered/playing
roster before permitting another ordinary funded entry. It delegates prices,
wallet selection, accounting, eligibility, capacity, freeze, cutoff and receipts
to the unchanged ordinary Horse admission authority. Existing paid-entry replays
remain valid, and a ticket issued after the caller's hint read can still be
redeemed at quota with wallet funding explicitly disabled. Ticket errors remain
errors. This target is an automated attendance choice, never a restriction on
a person's registration.

The MTT caller passes its intended absolute target, clamps it to the prestart
curve, and treats a satisfied target as a normal stop without penalizing a
Horse. Bought-seat formats retain their existing door. The schema manifest
declares the new authority so an engine cannot activate without its prerequisite.

## Regression protection and local qualification

- The existing required accounting chain now runs 57 actual-wrapper/cap-lock
  checks, including the before/after race, 80 overlapping inputs stopping at
  exactly 31 entries, paid/ticket replay, invalid targets, rollback, permissions
  and a positively observed lock wait where closure wins before admission.
  This small fixture uses controlled economic delegates and does not by itself
  certify financial formulas.
- The existing full financial activation fixture separately installs the new
  migration and exercises its real Horse admission closure: an actual 200-chip
  purchase has matching wallet, ledger, entitlement and accounting-frame records;
  a full-target refusal and lost-response replay leave financial state unchanged;
  a missing original-funding capture rolls the entire attempted purchase back.
  All four native groups and 14 isolation race cases pass, with exact source
  bindings checked again at completion and both cluster cleanup predicates true.
- Engine tests cover explicit target propagation, invalid input, ordinary quota
  completion, wallet selection, paid-ticket recovery, refusal backoff, shutdown,
  finalized pools, fleet holds and existing count authority. The first connected
  run passes 117 tests in ten files. Root and server TypeScript checks pass.

The full financial runner previously defaulted its socket directory to `/tmp`
despite accepting an explicit owned work directory. Its default now keeps both
the cluster and socket beneath that directory; the explicit socket override is
preserved. A constructor regression and all 35 runner unit tests pass. This
permits the required local financial qualification on the owner's external SSD.

## Delivery and acceptance

These are local qualification results, not a production completion claim.
Protected merge, exact migration installation/readback, engine publication and
natural runtime evidence remain required. No production registration, financial
probe, repair loop, runtime patch, existing-record rewrite or extra release
operation was used. Phase 1's pending release/live-registration acceptance is
tracked separately; beginning Phase 2 does not mark Phase 1 complete.

## Hosted installer blocker

The required accounting and Daily Missions installers repeatedly failed before
tests on TLS EOF downloading the signing key from the PostgreSQL website. The
package repository serves the identical key (both SHA-256
`0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76`).
Those two installers now fetch from that repository directly. HTTPS, curl
failure propagation, Signed-By, signed package validation, PostgreSQL version,
tests and deadlines are preserved. Regression contracts cover both installers;
actual hosted execution remains required. Other standalone workflows that
passed their bounded infrastructure retry retain their source.

## Shared-fleet capacity qualification

The maintained purchase-budget qualification additionally drives 1,000 isolated
accounts, each with two existing tournament promises, across eight distinct
event targets of 313, 143, 127, 91, 80, 69, 53 and 41. It checks each persisted
field independently, exact 917 controlled charges, exercised cross-event cap
refusals, no fifth promise, and original-entry recovery over fresh connections.
These are the actual acquisition and capacity wrappers with controlled
economic delegates, not production registrations or a performance benchmark.
The separate original financial qualification remains necessary for money.

## Local historical-controller fixture input

The connected withdrawal regression still failed alone at its unchanged
five-second floor-CLI deadline. Git trace recorded 0.4–0.7 seconds per repeated
policy blob read through the shared repository's packs. The fixture now copies
its exact commit, source blobs and containing trees into its private Git object
database before entering that deadline, verifies every copied object ID and
copies the real reachable commit graph for immutable ancestry, with no shared
object alternate inside the timed helper. Normal Git fsck stays enabled. No production
controller, deadline, source identity, policy or admission assertion changes.
