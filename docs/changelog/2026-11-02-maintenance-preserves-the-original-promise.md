# Maintenance preserves the original announced release boundary

The serving EED engine twice invoked its countdown one millisecond before its
announced start. It persisted that raw start and an end exactly 300 seconds
later. The release controller correctly refused the shortened 120/300-second
promise. The new runtime timer fix cannot bootstrap itself through that old
runtime's certificate.

The v3 thaw now takes the later of the raw end and the original announcement
plus seven minutes. Its raw start, token, ledger key and installment protocol
stay intact. For the demonstrated early timer, every actual clock target gets
300.001 seconds and admission remains closed through the original promise.
Installation requires the exact prior definition and quiescent maintenance;
complete historical receipts are never edited or replayed.

The existing controller can bind the original promise only for the exact EED
source and exact one-millisecond raw difference, with a fresh authenticated
read-only database contract, matching elected process and durable freeze row.
The physical checkpoint, native fence, reported remaining time and absolute
cutover deadline retain the conservative raw endpoint. The full 120-second
notice and 285-second reserve are unchanged. The independent database witness
has service-only execution and cannot announce, freeze, thaw or deploy.

The existing cancellation and immutable resolution path additionally qualifies
41432783729-1, source 6d178de0dbb1bdb2d74fb9b478a11768619a0a93, against its exact
original promise and historical full thaw. It cannot infer terminal state from
a timeout. Its process, retained-edge, Inspector, receipt and two-read custody
requirements remain enforced. Earlier owner histories remain readable.

Qualification uses disposable PostgreSQL with the actual v3 workers and freeze
predicates, all 15 nonempty deadline families, committed installments, owner
rotation, replay, late recovery and unchanged money/rosters. The immutable EED
thaw client consumes the actual SQL responses. Native qualification runs in the
existing required maintenance lane. Controller regressions execute the actual
binder and embedded certificate programs; cancellation regressions exercise
both exact original controllers and interruption boundaries.

Local qualification is recorded in the owning checkpoint. Protected merge,
installation, census, sealed activation and production gameplay remain separate
acceptance requirements; this source entry is not a deployment claim.
