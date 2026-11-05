# The horses' long-term memory saves again (2026-11-05)

Horses are the AI players. They remember how every opponent plays (how often
they raise, fold to bets, 3-bet, and who targets whom), and that memory is
meant to be saved to the database every five minutes so it survives a restart.

## What was wrong

**1. Long-term memory stopped saving a few minutes after every engine start.**
On the 2026-11-05 15:10 UTC engine, `horse_mind_stats` and `horse_mind_pairs`
were last written at 15:16 UTC and then never again, while the horses kept
playing about 3,500 hands a minute.

Since 2026-10-26 each horse learns from a completed hand only inside its own
private memory, so one horse never sees what another horse privately knows.
That part is correct. But the change also removed the one step that taught
the shared long-term memory, which is the only memory the five-minute save
reads. The save therefore had nothing new to write after the start-up
replay's first save, and each restart reloaded only what that replay rebuilt.

**2. The "own history loaded" counter undercounted.** When a horse's own past
hands loaded and shared public notes were also available, the load was counted
as "refused" (13 loaded vs 134 refused in 4.6 live minutes), because only one
of the two receipt shapes was recognised.

## What changed

- Every completed hand is learned once more by the shared long-term memory,
  after the horses' private memories learn it. The table's owning decision
  worker learns it directly and marks those players for the next save; the
  other workers add it to their copy without saving it, so each player's saved
  row covers every table on the floor and is written only by the owner. This
  is how it worked before 2026-10-26.
- Decisions still never read the shared long-term memory, so no horse gains
  anything another horse learned privately.
- The own-history counter now counts a load whenever the horse's own history
  loaded, including when shared public notes came with it.

No database change; the save, its tables and its size limits are unchanged.

## Tests

`server/src/engine/horseDecision/workerRuntime.test.ts`:

- a completed hand sent through the real worker and private-memory path is
  written by the actual save functions as the expected opponent rows and the
  3-bet targeting row;
- without the fix the same hand writes nothing (the live defect);
- a hand from another worker's table is learned but not saved by this worker,
  and the owner's save carries both hands;
- a live decision still cannot see the shared memory;
- the history counter counts both receipt shapes correctly.
