# server/src/engine/holdJitterDoesNotStackOntoRest.law.test.ts

Anchors post-hand completion hold to HAND_COMPLETE acceptedHandEndedAt and absorbs bounded hold-timer overshoot into armNextHandRest so consecutive setTimeout jitter does not stack past ENGINE_BETWEEN_HANDS_BUDGET_MS while preserving visible hold and board-clear beats.
