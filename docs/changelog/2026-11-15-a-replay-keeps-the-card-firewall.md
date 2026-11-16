# A Replay Keeps The Card Firewall (2026-11-15)

## What Was Wrong

The live engine hands the brain every horse decision behind a
hidden-information firewall (`ServerTableEngineTurns`, `publicPlayers`): every
seat in the shared state has `cards: []`, and the horse's own cards exist once,
on the deciding player passed beside the state.
`HorseComplaintReplay.stateAt` left the horse's hole cards on its own seat in
`gs.players` (the deciding player was the same object as that seat), so every
pack that refuses a state carrying private cards refused every replayed
decision with `private_state_rejected`.

## Evidence

- Committed complaint fixtures, every horse node with recorded cards, every
  replay profile, seeds 1, 7, 42: before, Phase 10 refused every PLO4 node and
  Phase 11 every PLO5 node as private state; after, none is refused (they
  reach their next reason). The replayed action kinds are unchanged in all 276
  node and profile cells (the packs run in shadow).
- Fixed-limit nodes: before, Phase 12 and Phase 13 refused every replayed
  decision; after, both read it (`phase12_<variant>_eligible`, `phase13_eligible`).
- Recorded Horse-only fixed-limit cash hands (Fixed-Limit lane, 1,845 hands,
  with `phase12Remaining: 'candidate'`, so the pack's answer is executed): the
  flh button folded first in 46.3 % of replays without the firewall, 76.4 %
  with it, against 78.6 % recorded.

## Fix

`stateAt` builds every seat with `cards: []` and returns `hero` as its own
object carrying the horse's recorded cards, as the live `decisionPlayer`.

## Law

`server/src/engine/horseComplaints/a-replay-keeps-the-card-firewall.law.test.ts`
