# server/src/lightning/aBigBlindPreflopLookWaitsForItsPrice.law.test.ts

In Lightning a Horse big blind is not asked a preflop early look while a live seat between the last raiser and the big blind still owes chips to the current bet: it decides once, on its own turn, at the price the callers made, and that answer is the one executed (no held Lightning Fold from a look priced before the callers came in). Every other early look (any seat at the deal, any later street) is unchanged.
