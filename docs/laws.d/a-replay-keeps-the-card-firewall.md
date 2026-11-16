# server/src/engine/horseComplaints/a-replay-keeps-the-card-firewall.law.test.ts

A horse decision replayed from its recorded public node (HorseComplaintReplay.stateAt) is built behind the live engine's hidden-information firewall (ServerTableEngineTurns publicPlayers): no seat in gs.players carries hole cards and the horse's own cards exist once, on the deciding player, so the packs that refuse private state (Phase 10, 11, 12 and 13) read a replayed decision as they read the live one instead of refusing it as `private_state_rejected`.
