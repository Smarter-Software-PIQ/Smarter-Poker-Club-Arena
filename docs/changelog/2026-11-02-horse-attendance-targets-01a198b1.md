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

- The existing required accounting chain now runs 69 actual-wrapper/cap-lock
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

## Installed admission authority and event-level refusals

Read-only production inspection found that the captured gate predated the
installed October 31 Diamond owner-closure guard. The fixture now uses the
byte-identical gate from that protected migration, verified against production
at 17:05:25 UTC: definition MD5 `2622a05f060e54b18204205fc08bc7e9`,
body MD5 `53ee3a9093eaa3388d1e2c70bbdcfe98`. It preserves the existing
closure, operator park and paid-entry continuation rules. No live gate changes.

Four reproduced caller regressions showed event-wide closure/park/missing/
completed refusals penalizing individual Horses and consuming the remaining
offer queue. The caller now ends that pass normally on those authoritative
refusals. Unit and native regressions retain zero new charges and the existing
paid replay exemption. This introduces no new hold or closure.

## Private Git qualification inside push hooks

The full pre-push run reproduced two private-object assertions failing while
all other 389 root files passed. Git exports repository-local environment
variables to hooks; `git -C` alone does not override `GIT_DIR`, so private
object writes were redirected to the source repository. The fixture now clears
Git's enumerated local variables for every private repository command and the
actual timed floor helper. The wrapper always supplies the source `GIT_DIR`
to retain this regression outside push hooks. Exact object/ancestry checks and
all deadlines remain unchanged. Both original profiles pass under that inherited
environment; full wrapper and normal push checks remain required.

## Protected-main integration

Preserved all 59 withdrawal cases, including the distinct current26 target and
controller. Promisor source hydration occurs in the validated batched object
read before the private helper starts; exact copied objects and the real commit
graph remain local. This replaces the earlier macOS-only 15-second historical
fixture allowance with the original five-second helper deadline. The integrated
wrapper passes all three checks in 36.20 seconds. Object bytes use a distinct
variable so the newer timestamp-mutation case retains its original request text.
Root and server compilation pass; all 117 bound financial inputs are unchanged.

The next protected integration retains the stronger foreign-Git sentinel
wrapper and native environment isolation byte-for-byte from main. Its 59
cases pass with the private object closure (three wrapper checks, 44.97s),
and the sentinel proves no HEAD or refs changed. Root compilation passes;
the 117 financial source hashes still match the retained qualification.

## Hosted Unix socket path regression

Accounting shard 3 failed before its retired-cash custody assertions: the
PostgreSQL log showed an archive-root socket longer than the kernel's 107-byte
limit. The previous owned-work-parent change exposed a caller that accepted
`--socket-root` but only redirected the old literal `/tmp` default. It now
passes the explicit root through the maintained constructor and removes that
monkeypatch. The shared runner validates actual encoded socket path length,
keeps short work parents, selects a configured private TMPDIR/RUNNER_TEMP when
the default is too long, and refuses an overlong explicit root with its own
empty constructor allocations cleaned. Mac fallbacks remain on the external SSD.
No financial rules, production deadlines or assertions change.

The new long-root regression failed before the correction. All 40 runner cases
now pass, including explicit-root authority, configured-root fallback and refusal
cleanup preserving a foreign sentinel. The actual previously failed private
custody case passes on PostgreSQL 17 with a long data path and short explicit
socket, with stopped/removed cleanup verified. Only current runner source pins
and additive audit notes changed; historical acceptance remains intact. Fresh
financial activation qualification passes four native groups and 14 stock
isolation races, with current source binding and cleanup verified.
