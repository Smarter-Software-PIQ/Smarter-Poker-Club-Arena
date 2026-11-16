# An Incomplete Opponent Profile Is Capped (Default Off)

Option `holdemProfileCompletenessCap`, read only as `=== true`, default OFF.

## What was wrong

The style read has a documented discount for a stored opponent profile that is not complete (its legacy back-fill is still pending, or it has no public memory domain on file): confidence capped at 0.4. On the live path it never applied. Every production decision reads its opponents from pooled public rows inside a sandbox that reported the profile as live and complete, so half-built profiles counted at full weight.

## What changed

With the option on, the observer reads name each pooled exact or donor row that fails `profileQualification` in the decision's own detached state. `HorseMind.styleProvenanceOf` reports those reads as incomplete and the existing cap applies. The exact row governs over a donor row. The named rows travel in read frame v17, so the fast look, the deep look and exact replay agree. Receipt `holdem_profile_completeness_cap_seen`.

With the option off nothing is carried: the state, the read frame and the decision are exactly what they were.

## Evidence

`anIncompleteProfileIsCappedThroughTheWorker.test.ts`: through the real worker runtime, a back-fill-pending row reads at the cap on FAST and DEEP and replays exactly (frame v17); off, the same row reads uncapped and is byte-identical to a complete row; on with a complete row, the frame equals the off frame.

## Not done

Value is not measured. A live switch row alone does not yet reach the observer reads (same wiring as the shown river memory follow-up).
