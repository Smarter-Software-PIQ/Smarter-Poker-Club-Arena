# Omaha Hi-Lo keeps the low half under pressure; fixed limit is never jam-or-fold

Two Horse correctness defects from the heads-up variants audit (HU-HILO-001,
HU-FL-001).

**Omaha Hi-Lo.** The Omaha pressure cap is a ceiling for a weak high hand
facing a bet of 0.6 pot or more. It was applied to the whole pot share in
Hi-Lo, so a Horse holding the nut low with a weak high folded the river to one
pot-sized bet heads-up, 20 seeds of 20, although the low half alone returns 18
for a call of 12. Heads-up on a pot-limit Hi-Lo river the cap now never goes
below half of the hand's own low share (`server/src/engine/HorseHiLoLowHalf.ts`).
Fixed-limit Hi-Lo, multiway pots and earlier streets are unchanged.

**Fixed limit.** A fixed-limit raise is one bet whatever the stack. The
no-limit jam-or-fold gates and the pot-limit tournament commitment zone had no
fixed-limit exclusion, so short fixed-limit stacks were played from a jam
chart: heads-up at 10 big blinds the small blind folded 88 percent and the big
blind folded 87 to 91 percent to one small bet at 3 to 1. A fixed-limit stack
now enters none of them (`server/src/engine/HorseFixedLimitStructure.ts`,
four gates in `HorsePreflop.ts`). Stacks of 30 big blinds and deeper decide
exactly as before.

Laws: `AFixedLimitStackIsNeverPlayedJamOrFold.law.test.ts` and
`ANutLowIsNotFoldedToOneBetHeadsUp.law.test.ts`, both failing before and
passing after. The qualified fixed-limit deep-stack domain
(`remainingVariants/FixedLimitDeepPolicy.test.ts`) is unchanged and untouched.
The October 16 opponent-exploit neutrality corpus is not re-recorded; it
isolates the two new pure modules the way it isolates every later baseline
rule.

Paired heads-up self-play against the previous engine on duplicate deals,
1,500 pairs per cell, big blinds per hand: fixed-limit hold'em cash 10bb
+0.11 (standard error 0.03), tournament 10bb +0.14 (0.04), 15bb +0.07 (0.04),
20bb +0.10 (0.04); fixed-limit Omaha Hi-Lo tournament 10bb +0.16 (0.03), 15bb
+0.02 (0.02); pot-limit Omaha Hi-Lo cash 100bb -0.01 (0.03), tournament 50bb
0.00 (0.02), 25bb 0.00 (0.01). Control cells at 100 and 400 big blinds in
fixed limit: zero changed decisions. Horse against Horse only.
