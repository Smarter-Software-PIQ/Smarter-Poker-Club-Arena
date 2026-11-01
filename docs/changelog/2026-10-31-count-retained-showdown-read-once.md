# Count a retained showdown read once

The original continuation dispatcher awaits each retained event consumer. Its WINNERS consumer already waits the 1,400 millisecond showdown read before publishing the pot win. After HAND_COMPLETE, the dealing loop waited the entire completion specification again, including that same read. This made the retained path add an unnecessary 1.4 seconds.

Only the completed read in the ordered original dispatcher now counts against the following display hold. Pot push, all-in extensions, additional award groups, multi-board and BBJ holds, required rest and cash rebuy windows retain their full durations. Database latency and event-loop lateness never become animation credit. The credit is local, consumed once, and reset for every hand; replay performs its own actual presentation.

A real WINNERS consumer and fake clock reproduce the old double count (one failing assertion before the credit), then pass with it. The affected original-controller, action-pacing and cadence suites pass 84 tests; existing completion, all-in and next-hand contracts pass 41 tests. This corrects one proven display delay. Live next-hand telemetry separately shows slow financial obligations and fresh input reads; the display correction is not a claim that those larger delays are resolved.
