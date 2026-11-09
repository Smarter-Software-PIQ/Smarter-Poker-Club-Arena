# Held-out plan drafter and the riverPositionDefense draft (2026-11-08)

`server/src/scripts/featureAblationDraftPlan.ts` builds a domain-scoped,
closure-bound held-out plan from the exact source bytes, with every binding
computed the way the provider and admission verify it, and validates it. It is
a review tool: no registry write, no provider run, no held-out deal.

The `riverPositionDefense` draft (NLH, 2 dealt, 100bb, 24,192 pairs in 21
cells, family 283) validates on the #10048 head. Registration is held for the
owner's decision on family 283 membership, which is irreversible; see
`docs/horse-measure/2026-11-08/river-position-defense-heldout-draft.md`.

Tests: `featureAblationDraftPlan.test.ts` (3); server `tsc --noEmit` clean.
