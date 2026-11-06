# Shared public memory follows original speed and ante rules

Public opponent profiles previously mixed table and Lightning play and ante
styles inside the same variant/mode/table-size key. The new additive profile
store and versioned observer contexts separate the original speed and ante
rules. Producers capture controller blind snapshots; accepted history retains
them. Exact saved reads, bootstrap, completed observations and worker sandboxes
use that same domain. Legacy rows and old readers remain intact; missing
original domain is not silently relabeled or imported into an exact partition.

Only a protected atomic acceptance receipt can teach the new store. It must
match the original hand ID, table and hand number. Manual history inserts,
receipt updates, mismatches and duplicates do not teach it; transaction rollback
also rolls back learning. Public actions alone enter the counters, with existing
chronology, privacy and sorted actor lock order preserved.

The isolated PostgreSQL proof covers the original dynamic history insert,
accepted receipts, manual-insert refusal, duplicate/update/rollback/mismatch
boundaries, old missing-domain acceptance, saved reads, permissions and private
card invariance. Existing context, cache, bootstrap, worker, accepted-history
and source-binding tests pass. The original-domain helper is in the reference
source closure. Full normal delivery gates remain required.

Install the additive migration through its declared daily maintenance route
before activating the new engine. It changes the hot history table and adds an
acceptance trigger; no production installation is claimed here. Historical
individual packets without original per-hand domain proof remain unavailable
to the new context. Exact saved pooled rows and new accepted completions are
supported; this is not a claim that lost history was reconstructed or that a
strategy gained qualified profitability. Served identity and actual selected
public-memory receipts remain separate live proof requirements.

Integration with the continuation-plan source preserves both registered digest
closure entries. Fleet receipt tests now exercise the real version-2 validator
instead of a simulated future adapter. Missing or rejecting validators and
mismatched/future receipts still produce zero observed exact-memory reads; a
valid read still does not certify strategy application.
