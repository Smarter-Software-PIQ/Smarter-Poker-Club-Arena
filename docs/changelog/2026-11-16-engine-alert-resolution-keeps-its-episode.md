# Engine alert resolution keeps its producer episode

The engine appends separate firing and resolved rows. Reliability intake treated
those row IDs as different alert members and ignored the retained inner episode
ID. The November 16 fleet-floor resolve therefore remained escalated as
`resolved_not_of_this_episode` after its producer recovered.

The original intake now keys a validated engine episode by alert name, component
and producer UUID. Untagged or malformed legacy rows keep the strict unknown
behavior. Other producer families and recovery quiet windows are unchanged.

A single one-second lock attempt on the operational inbox serializes the brief
projection upgrade with its original insert transactions. Refusal rolls the
whole migration back; it never locks gameplay or financial tables.

The migration upgrades only current firing member projections proved by retained
engine source receipts, with a 200-record bound and collision refusal. It resumes
original rejected resolve deliveries through the original intake, retaining their
observation IDs, receipts, times and occurrence counts. It neither clears source
alerts nor marks recovery without the normal quiet-window decision.

The existing native PostgreSQL controller harness reproduces the old rejection
before the migration and verifies the retained delivery after it. The maintained
workflow includes the new migration. The socket-root override permits its local
native cluster to stay on the required external SSD.

Source and local validation are preparation. Protected merge, installation and
production incident readback remain required; the engine census repair still
requires certified engine activation separately.
