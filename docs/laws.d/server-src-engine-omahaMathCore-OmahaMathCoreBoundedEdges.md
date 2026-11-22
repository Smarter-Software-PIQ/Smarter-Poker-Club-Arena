# server/src/engine/omahaMathCore/OmahaMathCoreBoundedEdges.law.test.ts

In PLO4 and PLO5 range tracking (`OmahaMathCoreRangeTrack.likelihood`, facing-a-wager branch), a raise edge is never blurred wider than the measured region it bounds (`eV = min(seF, vTop)` for value, `eB = min(seF, alpha * r)` for bluffs); when `seF` is already inside both regions the likelihood is bit-identical, equal widths reproduce the single-width band share, and a weak holding far outside a narrow bluff-raise region receives negligible bluff-raise weight.
