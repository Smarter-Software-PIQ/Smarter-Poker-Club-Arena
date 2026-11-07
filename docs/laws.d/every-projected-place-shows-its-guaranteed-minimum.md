# tests/every-projected-place-shows-its-guaranteed-minimum.law.test.ts

While registration is open on a guaranteed event, every surface that projects a place (GameLobbyPanel Payouts, TournamentInfoPanel Prizes, TournamentPage Payouts, RewardsTab) prices its guaranteed minimum on places + the house share still due through the one shared hook `useTournamentPrizeFunding` (the only client caller of `fn_ca_tournament_prize_funding`) and the one helper `pendingHouseShare`, by the one ladder rule `effectivePlaceLadderPool`, so no two surfaces can disagree on the same event.
