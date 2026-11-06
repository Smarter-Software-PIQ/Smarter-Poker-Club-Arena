# tests/a-held-original-that-never-started-does-not-hold-the-restart.law.test.ts

A restart certificate held shut by cards_in_air is admitted only when the drained-boundary witness (engine-release-inflight-hands.py --drained-predecessor) proves no tournament hand is moving, no incomplete snapshot was written in the window and no recent Lightning hand is unsettled, with the engine's handsInFlightTotal present and zero; any other witness answer, a missing witness, or any non-bounded reason beside it refuses, and cards_in_air never enters BOUNDED_ONLY.
