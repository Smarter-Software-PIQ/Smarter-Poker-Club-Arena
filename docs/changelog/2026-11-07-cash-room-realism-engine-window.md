# 2026-11-07 - Cash-room realism: one owner window for the off-cycle engine release

## Owner order

Dan, round 3 realism chat, 2026-11-07, America/Chicago, verbatim:

> "COORDINATE WITH THE \"ENGINE CUTOVER AND UPDATE STATS\" CHAT TO GET THIS DONE NOW, NOT AT 4AM"

and at 13:47:

> "GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY
> ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS. YOU DECIDE THE BUILD ORDER."

## What ships

The horse cash-room realism items merged after the 21:20Z release of
`391f7bc0` (the consumed `2026-11-07-horse-fold-provenance-engine-1800z`
window):

- #9930 (`53267870ae`): horses choose a chair like a person and step away
  without dodging the hit-and-run rule.
- #9929 (`4a7dfd6df7`): several lists, a table fills from its list in order,
  visible table breaks.

## The window

`2026-11-07-cash-room-realism-engine-2230z`, mirroring #9903 file for file:

- `owner-maintenance-windows.json`: one new engine entry, earliest-certified,
  `supersedesPhase1Schedule`, no migrations, 22:30Z to 04:30Z, `contains`
  `4a7dfd6df7`, release witness = sha256 of the new floor.
- `playerNoticeAt` 22:10Z (twenty minutes before `notBefore`, the booked-window
  notice law from #9952); `src/utils/ownerMaintenanceNotices.json` regenerated so
  the client banner names the window. The release is dispatched only after the
  client publication carrying that notice is live.
- `activation-floor.json` moved to this window.
- `engine-release-activation-floor.py` NOV7 owner id, floor digest and order
  digest; `engine-release-seal.py` claim name, predecessor `391f7bc0` and expiry;
  `engine-release-transaction.sh` window id and predecessor at each site.
- The fold-provenance archive gate and the explicit door list of the previous
  order are not carried over: this release has no migration, and every door
  the target lists (`engine-release-window-doors.py list`) already exists in
  production `pg_proc`, so the ordinary door check covers it.
- `read-scoped-release-recovery.py` keeps the previous producer pair at the
  end of `RETAINED_REFUSAL_PRIOR_SOURCES`.

## Tests

- `engine-activation-floor.test.py`: the new window binds the live floor and
  order digest; the provenance window keeps its pinned historical floor.
- `an-engine-activation-floor-precedes-runtime-writes.law.test.ts`: the new
  case is selected (54 cases).
- `daily-engine-maintenance.law.test.ts`: historical-registry reconstruction
  removes the new entry too.

## Main repair carried here

`v31-pio-bet-totals.yml` (#9957) merged beside #9950 still downloaded the PGDG
key, so `the-postgres-signing-key-comes-from-the-checkout.law.test.ts` failed on
main. It now installs the key from the checkout like every other workflow.
