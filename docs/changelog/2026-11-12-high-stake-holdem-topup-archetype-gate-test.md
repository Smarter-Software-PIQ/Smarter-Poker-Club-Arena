# The High-Stake Hold'em Reload Is Pinned To Its Three Archetypes (test only)

2026-11-12. Hold'em Strategy lane. No engine source changes; no release is owed.

## What was missing

`HorseSessionRotator` reloads a Hold'em cash Horse from under 80% of the
reference buy-in, instead of the ordinary 45%, when the table's
dollar-equivalent big blind is 5 or more and the Horse's `holdemPersonaFor`
archetype is lag_shark, tricky_trap or tag_crusher. The only Hold'em witness
was one tag_crusher seat inside `HorsePloEliteOverhaul.test.ts`, and that seat
was chosen with the PLO resolver. Nothing pinned the Hold'em resolver, the
tricky_trap member, the nit_hunter exclusion or the stake boundary. The persona
requirement map recorded this as row 22, "no test found for the archetype
gate".

## What the test pins

`server/src/services/TheHighStakeHoldemTopUpIsForThreeArchetypes.test.ts`
runs the real rotator pass against four Hold'em seats:

- big blind 5, stack 70%: lag_shark, tricky_trap and tag_crusher each add 150
  to reach the table maximum; nit_hunter adds nothing;
- big blind 2, stack 70%: nobody reloads;
- big blind 5, stack 40%: nit_hunter reloads under the ordinary rule, so the
  exclusion is from the early reload only.

Each Horse is chosen so the PLO resolver would give the opposite answer, which
makes the resolver part of the assertion.

## Proof that it bites

Four temporary edits to `HorseSessionRotator.ts`, each reverted: removing
tricky_trap from the set, adding nit_hunter to it, lowering the stake boundary
from 5 to 2, and reading `ploPersonaFor` for a Hold'em seat. Each one fails a
named case; the unedited source passes 4 of 4.

## Limits

Diamond tables (chip big blind divided by 100) are not exercised here because
that path also reads Diamond custody. Wallet, exposure and stop-loss bounds
stay with `HorseBankroll.test.ts` and `HorseBankrollWiring.test.ts`. The plan
line names two archetypes (LAG and TAG); the shipped set has three. This test
records the shipped behaviour and does not decide which is intended.
