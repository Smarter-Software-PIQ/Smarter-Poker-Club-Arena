# Omaha Tight, Maniac And Unknown Opponents: Matched Fixed-Input Law (2026-11-13)

Test only. No production behavior change.

`server/src/engine/HorseOmahaTightManiacMatched.law.test.ts` holds one public river spot (PLO4 and PLO5 cash, top pair facing a pot-sized bet), one hero hand and one seed list fixed, and changes only the opponents' remembered public history. It pins what the serving Omaha design does:

- Unknown and sparse opponents carry the shared presumption, which is not evidence: the committed action equals the action against a player whose own hands disproved the presumption (fold on every seed).
- A tight or passive opponent is recognised by the disproof and gets the same baseline, including when it makes one pot-sized bet. There is no tight exploit on this path.
- A sustained maniac (raises three hands in five and bets every street it is checked to) is recognised by its bet rate when checked to, and the same hand calls on every seed. In PLO4 its raise width is evidence too; three-handed PLO5 Horses raise too often for 60 percent to be credibly outside their envelope, so there the width stays presumed.
- Aggressor binding: an evidenced maniac who raised preflop, bet the flop and folded the turn changes nothing when a tight player bets the river; a tight player who folded does not change the call against the maniac who bets.
- Recency: a maniac who then plays 200 tight hands is back at the baseline; a tight player who then turns maniac is called.

Two facts for live grading: the call against the maniac carries the `maniac_call_down` receipt (with `postflop_maniac_call_down_checked` beside it where the raise width is only presumed), and the baseline against unknown, sparse and tight opponents carries no maniac receipt; and these reads decay by hands observed, not by age, so there is no stale-by-time case.
