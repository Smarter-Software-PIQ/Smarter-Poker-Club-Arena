# A photo opponent keeps the approved nine-seat phone size

2026-11-24. Production alert rows 448565 and 448543 (`PostDeployVerificationIncomplete`,
Post-Deploy E2E "Live-table and engine verification").

## What was wrong

On every release since at least 2026-11-22, a watched nine-seat cash table at
393px painted almost every opponent portrait at about 132 layout px, against the
140 floor in `PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponent` (CLAUDE.md 10.7c).

Live nine-seat tables seat uploaded photographs (Supabase storage avatars)
beside character art. `opponentAvatarLayout.ts` matches every opponent's
painted subject to the reference chair's:
`factor = min(target / ownSubject, ceiling)`. A photograph is opaque edge to
edge, so its subject is its whole frame; beside a character-art reference
(whose figure carries transparent margins) the match scaled every photo chair
down to the character's figure height. That is a ring-wide shrink, the shape
10.7c item 2 forbids. The fixture only ever used character art, so CI never saw it.

## Proof

Nine-seat spectator fixture, character art at the bottom chair and an opaque
photo on the other eight (`photo_portrait.webp`):

- main (`728aa5618`): `below the approved size: 2:126.4<140.0 ... 9:126.4<140.0`
- this change: every unconstrained chair 141.8; a too-wide photo takes its own
  rail size (allowed by 10.7c) and its floor scales with it.

## The fix

On the nine-seat phone rail the match may grow a portrait towards the hero
ceiling but never below the approved size: the factor the reference's own art
would take in that chair's box (`target / subject(image, heroAlpha)`). Wider
layouts keep their exact subject match (pinned by `tests/unit/opponentAvatarLayout.test.ts`).

## Pinned by

`fixed mobile avatar artwork: 9-max 2-card spectator photo opponents` in
`tests/e2e/support/mobileAvatarSizingCases.ts`, which runs the production floor
gate (`waitForMobileAvatarGrowth`) on every PR that selects `table-proportions.spec.ts`.
Recurrence on production still reaches the alert store through Post-Deploy E2E.
