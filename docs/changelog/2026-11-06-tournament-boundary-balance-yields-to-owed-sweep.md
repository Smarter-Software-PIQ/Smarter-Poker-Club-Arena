# Boundary balancing yields to an owed tournament sweep

The 45-day freeze investigation found a remaining starvation path beside the
November 6 boundary-balance watchdog. `TournamentManager.drainBoundaryBalance`
kept consuming new park edges in a loop. A sweep admitted during that loop
yielded and was marked owed, but another park edge could extend the drain
before the sweep was requested. Individually successful balance operations
could therefore indefinitely delay eliminations, registration wakes and finish
work. This reproduces a source defect; retained production evidence does not
establish that it caused the earlier c0b77808 25-minute delay.

The original drain now finishes its current operation, then gives an owed
sweep priority. Further park edges remain coalesced until that sweep settles.
The existing sweep admission and finally release the turn and resume pending
balance work. The first boundary move still runs immediately; no live move is
abandoned, duplicated or released early. No new scheduler or recovery loop is
introduced.

The existing break law reproduces the old failure (a second balance started
before the owed sweep) and exercises the corrected handoff, additional edges
before and during real sweep admission, and continuation after its finally.
The related boundary suite retains unknown-move, authority-loss and park-owner
coverage. Local qualification, protected integration and live proof are recorded
in the owning investigation checkpoint; this file does not certify deployment.
