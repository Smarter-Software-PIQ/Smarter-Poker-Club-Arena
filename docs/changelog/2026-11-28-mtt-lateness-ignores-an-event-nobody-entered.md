# MTT launch lateness ignores an event nobody entered (2026-11-28)

Production Alerts rows 450128 and 450194 (`MttStartedLate`, incident `mtt-started-late-cutover-hour`).

- **Cause 1: the cutover freeze is stamped 1 ms after the start minute.** Fixed by `20261128161915` (#12377), which allows a freeze start up to 5 s after the start.
- **Cause 2: an event nobody entered was counted as waiting.** Every 19:05Z alert read 2 because of the daily empty "Daily 25 Chip Freezeout" in a one-member pilot club. `emptyPastStartEvent.ts` cancels that event at start + 30 m, and TournamentNeverStarted already covers it.
  - `20261128200707` adds the same entrant test that `fn_tournament_metrics` uses. An event with one registered or playing entrant still alerts.

**Versioning.** The first draft was version `20261128160858`. Its version was older than #12377's, so it would have installed after #12377 and replaced #12377's body.
- The migration is re-versioned after #12377.
- It pins #12377's installed body (md5 `19533b7b…`) as its preimage.
- It keeps #12377's predicate unchanged.

**Proof:** `docs/production-alerts/evidence/450128-mtt-late-freeze-boundary/`.
