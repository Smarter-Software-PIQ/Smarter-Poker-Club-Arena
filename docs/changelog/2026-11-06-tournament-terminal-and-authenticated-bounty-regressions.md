# Native regressions for zero-pool completion and authenticated bounty credit

Two installed fixes lacked native coverage of their failing boundaries. This
change extends the existing required accounting runners; it changes no production
function, financial rule, migration or engine runtime.

The ordinary terminal fixture registers three free entries through the real
authenticated registration door and opens its empty escrow through the escrow
authority. The original cash authority fails with `23514` (empty ladder). Applying
`20261105203911` still fails the outer terminal contract with `P0404` (missing zero
winner line). Applying `20261105215135` then produces one zero winner line,
completes the event, closes its escrow and releases its final seat. Successful
rollback, unchanged monetary records and balances, exact replay, positive-pool empty-ladder
refusal and unfunded unfinalized-pool refusal are checked. An unfinalized pool is
not automatically invalid: the real guarantee authority may finalize it. The
negative case requires funding with no funding bank and must roll back. The
club comparison excludes only `updated_at`, which the existing zero-rake path
touches; every treasury and other club field remains compared.

The Diamond fixture invokes the actual private payout, wallet and profile-trigger
chain while retaining an authenticated JWT. It proves service context is false,
removes only the missing payout admission as a counterfactual, observes the exact
`42501` refusal and unchanged money, then applies the exact `20261022145452`
migration. The winner gains five Diamonds; the bounty bank retains five, with
prize/fee banks unchanged and custody conserved. Successful rollback and replay
are unchanged. A browser cannot execute the private payer; an unnamed write under
the authenticated JWT is refused by the profile guard. The retained catalog also
refuses a browser's direct profile write at its table ACL.

The zero-pool proof covers the ordinary cash branch with a synthetic final roster
and seat topology, not PKO bounty funding or final-two awards. The Diamond proof
covers the actual payout authorization boundary, not the complete authenticated
rebuy API or generation settlement. Both reuse retained financial foundations;
neither substitutes a fake financial helper or claims complete current engine
continuity. Original historical log counts are RPC failures, not counts of whole
event freezes. Protected merge and required hosted qualification remain separate
from these local native results.
