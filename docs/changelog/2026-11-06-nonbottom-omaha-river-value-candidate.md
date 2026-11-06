# Non-bottom Omaha river value routing candidate

A checked-to middle/top full house can return check from the initiative gate before reaching value evaluation when the prior aggressor remains behind. This candidate exempts only exact non-bottom full houses in known-card, single-board, high-only PLO4/5/6 river nodes with a legal bet and no amount to call. Bottom/singleton ranks, trip boards, split-low, multiboard, bomb-pot and all-in-or-fold contexts retain the gate.

The existing equity thresholds, value sizing, utility owners and legalizer remain authoritative. Facing-bet decisions are unchanged. The existing boat-threat API retains its result shape; the new rank-position helper also counts physically reachable lower full-house ranks. Those counts are not opponent probabilities.

Synthetic regressions failed before the gate connection and passed afterward, including a bet accepted through the controller menu while the aggressor remains behind. Frozen historical corpus tests isolate the newer rule without changing their goldens, assertions or RNG controls. The helper is included in reference source closure.

This is an explicitly unqualified local strategy candidate. It establishes heuristic action routing, not solved EV, original-hand replay, improved winnings, or permission to activate stale qualification artifacts. Original range/read-frame/RNG evidence and the maintained qualification/release gates remain necessary before activation. No private historical hands are included.
