# A renamed club's old links keep working (2026-11-14)

## What was broken

The Felt Society (`a0000000-0000-0000-0000-000000000001`) had slug `club-jaqk`
until a direct production update on 2026-11-14 changed it to
`the-felt-society`. Every `/hub/club-arena/clubs/club-jaqk/...` link then
failed:

- `ArenaAccessBoundary`, in front of every club route, asked
  `fn_poker_arena_context('club-jaqk')`, which matches id, code and the
  CURRENT slug only, and rendered "Arena Not Found".
- The lobby, settings, rules, invite, chip transfer and `getClub` reads built
  `resolveClubIdFilter(param)` and filtered the slug column directly, so they
  bypassed the rename history that #10879 (`club_slug_history`,
  20261114235606/235607) added and found no club.
- `strictClubIdResolver.resolveClubUUIDStrict` (members, player statistics,
  financials, reports, cashout and credit operations) threw "not found".
- The resolver persisted slug answers to localStorage as if a slug were as
  immutable as the six-digit code, so a slug freed by a rename and taken by
  another club would have kept opening the old club in any browser that had
  visited it.

## What changed

- `src/utils/clubIdResolver.ts`: `readFormerSlugClubId` is the one history
  reader (a failed read throws, so a strict caller never calls it "not
  found"). `resolveClubUUID` asks the clubs table first and the history
  second and never caches a history answer. Only the six-digit code is
  persisted; slug answers stay in memory for the tab, and a slug persisted by
  an older build is ignored on load. `currentSlugForFormerClubSlug` names the
  current slug for a former one.
- `src/utils/clubLookupFilter.ts`: `resolveClubLookupFilter` is the filter for
  a `clubs` read keyed by a route param. An id or code keeps its column with no
  lookup; a slug resolves through `resolveClubUUID` and the read filters by id.
  ClubHomePage, ClubSettingsPage, ClubRulesPage, InvitePage, ChipTransferModal
  and ClubDetailPage use it; `ClubsService.getClub` resolves through
  `resolveClubUUID` (importing the lookup module there hoisted its chunk into
  every chunk importing ClubsService and put AnalysisTab 0.02 KB over its stats
  budget). `resolveClubIdFilter` is now called only inside the resolver modules.
- A signed-out visitor never asks the history (it grants nothing to anon): the
  old slug does not resolve for them, nothing is reported, and it resolves and
  is rewritten once they sign in. A 42501 from a session that lapsed before
  the read is the same quiet answer; any other history failure is reported.
- `src/utils/strictClubIdResolver.ts`: a slug no club holds is read from the
  history before "not found"; a failed history read is a resolution error.
- `src/services/ArenaContextService.ts`: when the server finds no club for a
  slug, the resolver answers and `fn_poker_arena_context` is asked again for
  that club's id. Membership and authorization are therefore exactly the
  current slug's; nothing is granted on the client.
- `src/components/common/SlugEnforcer.tsx`: `/clubs/<former>/<rest>` is
  rewritten in place (replace) to `/clubs/<current>/<rest>` with the query and
  fragment intact, so `/clubs/club-jaqk/data?dataStart=2026-11-02&dataEnd=2026-11-09`
  becomes `/clubs/the-felt-society/data?dataStart=2026-11-02&dataEnd=2026-11-09`.

## Trade-off

A slug answer is no longer persisted across tabs, so the first club page of a
new tab opened by slug resolves the slug with one read before its membership
read. The six-digit code path keeps its persisted, zero-roundtrip start.

## Pinned by

`tests/a-renamed-club-link-keeps-working.law.test.tsx`
(`docs/laws.d/a-renamed-club-link-keeps-working.md`).
