# A Profile Post Count Asks The Post Policy Set-Wise (2026-11-26)

## Before

The public profile page (World Hub `pages/hub/user/[username].js`, three
calls, and `src/lib/cacheWarmer.js`) read its Posts number as
`HEAD /rest/v1/social_posts?author_id=eq.<id>` with `count=exact`. PostgREST
counts that through RLS, and the restrictive policy
`video_posts_public_select_guard` calls `legacy_transition_eligible`,
`fn_is_public_video_playback_eligible` and `fn_is_video_library_lineage_eligible`
once per row. They are SECURITY DEFINER SQL functions with `SET search_path`, so
none inlines and each re-initialises its nested helpers on every call (0.16,
0.51 and 0.77 ms per row). For author `00000000-0000-0000-0000-000000000001`
(5,636 posts) the anon count took 7,915 ms against anon's 3 s
`statement_timeout`: every signed-out visitor and crawler got HTTP 500 there,
and signed-in viewers waited about 8 s. Author `2d1cd6c3` (4,410 posts) is the
second such profile.

## After

`fn_social_profile_post_count(p_author_id)` returns the number of that author's
posts the caller may see. Same author: about 0.4 to 0.5 s signed out, signed in
or as the author (68 ms for `2d1cd6c3`). Read-only on production it equalled
the RLS count for all 495 authors as anon (8,313 = 8,313) and for six signed-in
viewers (both heavy authors as themselves, a native-video author, an only_me
author, a private-post author, a stranger), with no per-author difference.

## How

Migration `20261126232411_a_profile_post_count_asks_the_post_policy_set_wise`:
the cheap guard terms become column predicates, `fn_can_view_post` runs once
per distinct audience of the author, the playback and lineage helpers are
unfolded one level verbatim so their inner helpers run with cached plans,
`video_library_videos` is joined once by key, and `legacy_transition_eligible`
is asked only for a post with an unexpired transition row (a conjunct of its
own body). The World Hub client calls the function and falls back to the exact
RLS count if the function is missing or refuses.

## Root cause

A per-row RLS predicate built from non-inlinable definer functions was being
evaluated for every post of an author just to count them.

## Hardening

- The function pins an md5 (`fn_social_posts_visibility_fingerprint`) of every
  SELECT policy on social_posts, the three unfolded helpers and the RLS flags,
  and refuses with SQLSTATE 55000 when it changes, so it can never answer with
  an out-of-date rule. The install refuses the same way.
- The probe compares the function with the RLS count for up to 20 authors,
  signed out and as the author, before COMMIT.
- `tests/a-profile-post-count-asks-the-post-policy.law.test.ts` checks the
  fingerprint against the production rule snapshot, that the unfolded helpers
  are the snapshot's bodies verbatim, and that any later migration changing the
  rule restates the function.
