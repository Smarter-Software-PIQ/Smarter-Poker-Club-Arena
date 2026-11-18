# A superseded selection reaches the final rule exactly as proposed

When a Horse's qualified selection is replaced by the final rule, the decision
receipt is admitted only if that selection was what the final rule received.
The receipt validator checked the action but, for a call or an all-in, not the
recorded amount: an intermediate stage could rewrite or remove a proposed
call's price, or give a proposed all-in an amount, and the receipt was still
admitted. The earlier form of this check (#10377) refused that; the rewrite in
#10454 no longer did.

The validator now requires the final rule's input to equal the variant stage's
output, action and amount. Legitimate replacements by the wager rule, the
corrective rule or both in turn are admitted as before, and a proposed all-in
capped to the priced call is still admitted. The helper's comment now states
that the graph it receives must already have passed the full validator.

This tightens receipt admission only. The executed action and amount were
already bound by the graph, so no executed decision or chip amount changes. No
such receipt was found in production; the case was reproduced on the captured
PLO6 receipt and on receipts the live Omaha policy produces.
