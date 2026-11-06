# Original-node-bound conditional river chip costs

The offline Omaha river pricer previously admitted only zero-cost hands. A retained
two-dealt PLO5 cash river has captured rake, so treating it as zero-cost would give
the wrong check/bet comparison. The optional captured-chip mode binds the original
information hash, exact public price/menu and deduction configuration, then reuses
existing pure settlement helpers for finite win/tie/loss/fold terminals. No runtime
policy or production accounting is changed.

Uncalled excess is returned before deductions. Heads-up uses the existing 5% ceiling
and player-count cap. Ties retain gross-pot clockwise awards followed by the existing
single-board rake scaling, rather than incorrectly splitting the net pot. Other
scope guards remain: no raises, outstanding bet, ante/dead chips, split-low,
multiple boards, tournament, non-chip asset or applicable BBJ collection.

Focused Python tests call the real terminal bridge, including independent known
answers for caps, refunds and odd-cent ties, plus original-input and domain refusals.
The existing Horse study wrapper discovers these tests. Results are conditional on
declared full-holding ranges and responses; they cannot qualify or activate policy.
