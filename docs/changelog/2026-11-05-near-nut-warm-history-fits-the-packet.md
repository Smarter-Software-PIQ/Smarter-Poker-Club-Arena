# Near-Nut Development Histories Fit The Original Packet Bound

Running the declared development pilots for `smallPotNearNutRiverValue` showed
that every four-dealt and six-dealt PLO4, PLO5 and PLO6 profile refused before
dealing a pair: "Original worker public-history validator refused warm records".

The near-nut warm hands retain their public river nodes. Measured on the declared
profiles, 48 of them serialize to about 272 KB at four dealt and 367 KB at six
dealt, over the original 256 KiB public-history window. Only the two-dealt
profile (85 KB) could ever run, so four of the five declared shapes had no
development evidence at all.

The near-nut target now builds 32 warm hands (about 240 KB at six dealt) under
its own history version `small_pot_near_nut_value_raise-physical-public-node-warm-v2-32`.
The validator and its bound are unchanged. The multiway check-raise histories
fit at 48 and are unchanged, as are every other target, every reserved held-out
seed and the locked V24 and V53 plans. No held-out deal or activation is added.
`server/src/benchmark/NearNutWarmHistoryBound.test.ts` proves the original
validator admits every near-nut history at two, four and six dealt.
