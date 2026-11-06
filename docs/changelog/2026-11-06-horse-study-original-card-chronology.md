# Historical Horse analysis preserves original card information

The private study now recovers a Horse's validated original hole-card mapping
when its existing card sources are empty. It records provenance and refuses
invalid variants, card counts, duplicates and visible-board conflicts. It never
imports another player's private cards.

Pineapple preflop analysis no longer substitutes the final post-discard pair for
the original three cards. Postflop analysis requires the retained pair and an
earlier own discard. Short-deck ranking uses the maintained flush-over-full-house
and A6789 rules; Pineapple ranks only proven post-discard holdings.
River position and response counts exclude sitting-out seats, matching the
authoritative controller's action eligibility.

A private conditional river CLI compares check-through and finite legal bet
sizes in declared heads-up high-only PLO4/5/6 cash response models. It uses exact
arithmetic, returns uncalled excess, and refuses unsupported costs, missing
raise continuations or unsafe output paths. It is analysis tooling, not a solver,
historical range estimate, policy issuer or runtime activation.

Validation uses the existing Horse study Python/Vitest route, including original
card recovery, future-discard invariance, variant ranking and CLI refusal tests.
No live Horse decision policy changes in this commit.
