# A Restart At The :55 Mark Does Not Skip The Break

The engine restarted at 05:54:50 UTC on 2026-11-02. Its :55 timer fired ten
seconds later, before discovery had adopted any tournament, logged "no running
tournaments to pause" and returned without opening the break window. Every
tournament adopted seconds later passed `holdIfBreakIsRunning` with nothing to
hold it, and the whole platform dealt through that hour's break. A process that
started between :55 and :00 would also have skipped the hour entirely, because
the scheduler only ever arms the next :55.

- `triggerSynchronizedBreak` opens the window even with no tournament adopted
  yet (`openEmptySynchronizedBreakWindow`), so each tournament adopted inside it
  is held exactly like one that starts mid-break. With nobody in it, the window
  closes itself at the top of the hour.
- `catchUpSynchronizedBreakAtBoot` runs this hour's trigger once when the
  process starts inside :55-:00.
- A tournament adopted mid-break already runs its own break to the end recorded
  on its row (`hasOwnRunningBreak`). Neither the trigger nor the hold gives it a
  second five minutes.

Tests: `server/src/SynchronizedBreakDeadline.test.ts` "Synchronized Break After
A Restart" (window opens with no tournament and holds the next one adopted;
empty window closes at the top of the hour; no second break for a tournament
adopted mid-break; boot inside :55-:00 takes the break, before it does not).
