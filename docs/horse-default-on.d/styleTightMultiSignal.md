# styleTightMultiSignal (local commit on holdem/opponent-classifier-20261115; no pull request yet)

OFF. An opt-in arm (read as `=== true`). This file records where the option stands against the eight rows of
[HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) for a later promotion decision by the
Hold'em lead. Class definitions and targets: docs/changelog/2026-11-15-tight-beyond-vpip.md (CLASS-DEFINITIONS).

## Mechanism

MET. HorseOpponentStyle.tightMultiSignalRead, applied in classifyOpponentStyle only when the existing participation
routes leave the side neutral: VPIP credibly below the Horse mean (90%, 15 decayed hands) and raise share or fold to
3-bet credibly on the selective side (90%, 8 opportunities), no contrary evidence. Plumbed from HorseDecideOpts
through HorseMind's decision read options; receipt style_tight_multi_signal_seen.

## Input fidelity

NOT MET. Tested on synthetic counters and on a durable-import install; not on a recorded production node. The long
window and fold to 3-bet travel in the pooled rows and the read frame (v15), so the inputs exist on the production
path, but no production decision has been replayed with the option on.

## Value

NOT MET. No paired measurement. The consumers it reaches (#2's tight route, labels) have their own evidence; the value
of reading a fold-to-3-bet-heavy mixed player tight is not measured.

## Continuation

NOT MET. Not measured how such players continue against the adjustments #2 makes.

## Reach

NOT MET (not measured on production). By arithmetic: raise-heavy players are already tight through the call-share
route; the route reaches only players at or below the Horse VPIP mean whose fold to 3-bet is credibly above it (about
0.70 or more on 43.8 opportunities, full ring). Short-handed and heads-up Horses already fold 0.80 to 0.90 to 3-bets,
so there the line is 0.91 to 1.0 and reach is near zero.

## Scope

Hold'em style read, every format and size on its own Horse cell (cash, tournament and Lightning kept apart as today
by their rows); Omaha has no style consumers. Read only when a style consumer asks.

## Visibility

style_tight_multi_signal_seen (HorseDataLedger) and receipt.tightMultiSignal (posterior probabilities); league card
nlh_style_tight_multi_signal.

## Limits

- The declared raise-share route is redundant with the existing call-share route (measured); kept as declared.
- The graded human stays neutral unless his fold to 3-bet is credibly high; the engine and the method's 0.18 line
  still disagree for a 17 percent player who raises half of what he plays. That is a calibration question for the
  owner, not changed here.
- No delivery path: an `=== true` decision option has no production setter; promotion needs one (style switch or
  feature authority) and its replay plumbing.
