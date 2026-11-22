# server/src/engine/aReplayedHandHasNoForcedPostsInItsHistory.law.test.ts

A horse decision replayed from a recorded hand (HorseComplaintReplay.stateAt) carries exactly the actionHistory live HandController would hold at that node: the forced posts the hand record logs beside the actions (sb, bb, ante, straddle, post, bomb_ante, kill_blind, return) never appear, so a blind or ante poster facing a raise replays with the live heroPreviouslyActed and preflop orbit state instead of reading as having already acted.
