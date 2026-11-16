# styleStealTightBlinds (branch holdem/next-n2-steal-tight-blinds-20261115; pull request number at push)

This option is DEFAULT OFF (`opts.styleStealTightBlinds === true`) and OFF-ONLY in the live switch: its name matches the owner's blind-steal hold, so it cannot be switched on until the owner lifts that hold by name. This file is the evidence gathered so far and what is still owed.

## Mechanism

No-limit hold'em, first in (no raise, no limper) from the cutoff, button or small blind. When every player left to act is credibly tight and not aggressive by the existing style read (HorseTightPlayerExploit.tightNotAggressive), the open bar comes down by half of the fold-equity surplus over the open's break-even, scaled by the weakest read's confidence, at most 0.06 in preflop strength units (HorseTightPlayerExploit.tightBlindsSteal).

## Input fidelity

Reads only the style read of each player left to act, the pot and the Horse's posted chips. Two declared assumptions, not measured here: a blind folds to the open with probability 1 - min(1, 2 x his VPIP posterior mean), and the open priced is 2.5 big blinds.

## Value

Not measured. Owed: a declared paired evaluation against credibly tight blinds and a live read after the hold is lifted.

## Continuation

No new postflop rule: after the open the existing continuation rules play the hand.

## Reach

Fixed inputs (aTightPlayersBlindsAreStolen.test.ts): on the button with both blinds tight-passive the Horse opens more of the 169 starting hands; the count is printed by the test. League card nlh_style_steal_tight_blinds (expected inert: league seats decide with opponent memory off).

## Scope

`nlh` only, cash and tournament, deeper than the push/fold stand-down. Never Omaha, All-In-Or-Fold, bomb pots or bounty events. Stands down when any player left to act is unknown, loose, a maniac, value-heavy, attacking or in release.

## Visibility

Receipts style_steal_tight_blinds_seen and style_steal_tight_blinds_changed_action_seen. Ledger flag styleStealTightBlinds.

## Limits

The fold probability is an assumption, not a measurement of blind defence. Off is byte-identical (pinned: option absent equals option false, decisions and random stream).
