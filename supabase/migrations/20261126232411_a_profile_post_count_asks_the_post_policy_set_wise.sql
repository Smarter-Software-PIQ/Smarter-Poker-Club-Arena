-- 20261126232411_a_profile_post_count_asks_the_post_policy_set_wise.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT WAS WRONG (measured on production 2026-11-26, read-only):
--
-- The public profile page (World Hub pages/hub/user/[username].js, and
-- src/lib/cacheWarmer.js) shows "Posts" from
--   HEAD /rest/v1/social_posts?author_id=eq.<id>   Prefer: count=exact
-- PostgREST runs that as count(*) THROUGH RLS, and the restrictive policy
-- video_posts_public_select_guard evaluates legacy_transition_eligible,
-- fn_is_public_video_playback_eligible and fn_is_video_library_lineage_eligible
-- once per row. Each is a SECURITY DEFINER SQL function with SET search_path,
-- so none can be inlined, and each re-initialises its own nested helpers
-- (fn_extract_youtube_video_id, fn_is_video_library_asset_eligible,
-- fn_has_fresh_public_youtube_verification) on every call:
--   lineage 0.77 ms/row, playback 0.51 ms/row, legacy 0.16 ms/row.
-- For author 00000000-0000-0000-0000-000000000001 (5,636 posts) the anon count
-- took 7,915 ms against anon's 3 s statement_timeout, so every signed-out
-- visitor (and crawler) got HTTP 500 on that profile; 2d1cd6c3 (4,410 posts)
-- is the same. Signed-in viewers waited ~8 s.
--
-- WHAT THIS CHANGES:
--
-- public.fn_social_profile_post_count(p_author_id) returns exactly the number
-- of that author's social_posts the CALLER may see, computed set-wise:
--   * the cheap guard terms (is_deleted, private visibility, author = caller)
--     are applied as plain column predicates;
--   * fn_can_view_post (both policies) is called once per DISTINCT
--     (audience_mode, visibility, audience_list) of the author, not per row;
--   * the playback and lineage helpers are unfolded ONE level, verbatim, so
--     their inner helpers run at the top level with cached plans, and
--     video_library_videos is joined once by primary key;
--   * fn_extract_youtube_video_id runs at most once per row, and only for a
--     row the cheap terms have not already decided;
--   * legacy_transition_eligible itself is called only for a row that has an
--     unexpired video_reels_legacy_transition_rows entry, a conjunct of its
--     own body without which it is false.
-- auth.uid() is read from the request as the policies read it, so a signed-out
-- visitor, a signed-in stranger and the author each get their own answer.
--
-- Same author, anon: 7,915 ms -> ~0.4 s. Proven equal to the RLS count,
-- read-only on production, for all 495 authors as anon (8,313 = 8,313) and
-- for 6 signed-in viewers (both heavy authors viewing themselves, a native
-- video author, an only_me author, a private-post author and a stranger):
-- zero per-author differences.
--
-- IT CANNOT DRIFT FROM THE POLICY. fn_social_posts_visibility_fingerprint()
-- is an md5 of every SELECT policy on social_posts (name, command, permissive
-- flag, roles, expression), of the three unfolded helpers' source, and of the
-- table's RLS flags. The count refuses (SQLSTATE 55000) when it differs from
-- the rule this body was proven against, instead of answering with an
-- out-of-date rule; the World Hub client then falls back to the exact RLS
-- count. The pre-flight below refuses the install the same way, and
-- tests/a-profile-post-count-asks-the-post-policy.law.test.ts fails any later
-- migration that redefines the policy or a pinned helper without restating
-- this function.
--
-- No table, policy, row or helper changes. Creating a function takes no lock
-- on social_posts.
--
-- @live-proof: has_function_privilege('anon', 'public.fn_social_profile_post_count(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.fn_social_profile_post_count(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_social_posts_visibility_fingerprint()', 'EXECUTE')
-- @live-proof: public.fn_social_posts_visibility_fingerprint() = 'd3c8d33c93b12ec834115b3141d95fff'

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

-- The rule fn_social_profile_post_count unfolds, as one md5. Invoker rights:
-- it reads only the catalog, and only the definer below calls it.
CREATE FUNCTION public.fn_social_posts_visibility_fingerprint()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT md5(
    coalesce((SELECT string_agg(concat_ws('|', p.polname, p.polcmd::text, p.polpermissive::text,
                                         p.polroles::regrole[]::text, pg_get_expr(p.polqual, p.polrelid)),
                               E'\n' ORDER BY p.polname)
                FROM pg_catalog.pg_policy p
               WHERE p.polrelid = to_regclass('public.social_posts') AND p.polcmd IN ('r', '*')), '')
    || E'\n' ||
    coalesce((SELECT string_agg(pr.proname || '|' || pg_catalog.pg_get_function_identity_arguments(pr.oid) || '|' || pr.prosrc,
                               E'\n' ORDER BY pr.proname)
                FROM pg_catalog.pg_proc pr
               WHERE pr.oid IN (to_regprocedure('public.legacy_transition_eligible(public.social_posts)'),
                                to_regprocedure('public.fn_is_public_video_playback_eligible(text,text,text,uuid,text,text)'),
                                to_regprocedure('public.fn_is_video_library_lineage_eligible(uuid,text,text,text,text)'))), '')
    || E'\n' ||
    coalesce((SELECT c.relrowsecurity::text || c.relforcerowsecurity::text
                FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.social_posts')), ''))
$function$;

REVOKE ALL ON FUNCTION public.fn_social_posts_visibility_fingerprint() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_social_posts_visibility_fingerprint() TO service_role;

-- PRE-FLIGHT: the policy and helpers are exactly the ones this body unfolds.
DO $pre$
BEGIN
  IF public.fn_social_posts_visibility_fingerprint() IS DISTINCT FROM 'd3c8d33c93b12ec834115b3141d95fff' THEN
    RAISE EXCEPTION 'social_posts SELECT policy or a video visibility helper changed (fingerprint %); restate fn_social_profile_post_count against the live rule',
      public.fn_social_posts_visibility_fingerprint()
      USING ERRCODE = '55000';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_social_profile_post_count(p_author_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_n   bigint;
BEGIN
  -- THE PROFILE "POSTS" NUMBER, ASKED OF THE POLICY SET-WISE (2026-11-26).
  -- Exactly count(*) of social_posts WHERE author_id = p_author_id as the
  -- caller would see it through RLS: the permissive "Audience-aware view" AND
  -- the restrictive video_posts_public_select_guard. Counting through RLS ran
  -- three non-inlinable definer helpers per row and timed out (7.9 s) for an
  -- author with 5,636 posts against anon's 3 s budget.
  IF p_author_id IS NULL THEN
    RETURN 0;
  END IF;

  -- The rule this body unfolds, pinned. Any change to a SELECT policy on
  -- social_posts, to the three unfolded helpers or to the table's RLS flags
  -- refuses here rather than answering with an out-of-date rule.
  IF public.fn_social_posts_visibility_fingerprint() IS DISTINCT FROM 'd3c8d33c93b12ec834115b3141d95fff' THEN
    RAISE EXCEPTION 'social post visibility changed; fn_social_profile_post_count must be restated against the live policy'
      USING ERRCODE = '55000';
  END IF;

  WITH aud AS (
    -- fn_can_view_post of both policies, once per distinct audience of this
    -- author (a handful), not once per post.
    SELECT a.audience_mode, a.visibility, a.audience_list
      FROM (SELECT DISTINCT sp.audience_mode, sp.visibility, sp.audience_list
              FROM public.social_posts sp
             WHERE sp.author_id = p_author_id) a
     WHERE public.fn_can_view_post(p_author_id, a.audience_mode, a.audience_list) IS TRUE
       AND public.fn_can_view_post(p_author_id,
             COALESCE(a.audience_mode, NULLIF(a.visibility, 'public'), 'public'), a.audience_list) IS TRUE
  ), b AS MATERIALIZED (
    SELECT sp.content_type, sp.origin_type,
           (sp.author_id = v_uid) IS TRUE AS is_self,
           NULLIF(sp.media_urls ->> 0, '') AS playback_url,
           sp.playback_type, sp.rights_status, sp.youtube_video_id, sp.canonical_asset_key,
           sp.publication_key, sp.author_id,
           v.id AS asset_id, v.youtube_video_id AS asset_youtube_video_id,
           -- legacy_transition_eligible requires an unexpired transition row
           -- for this post; without one it is false, so it is only asked then.
           CASE WHEN EXISTS (SELECT 1 FROM public.video_reels_legacy_transition_rows t
                              WHERE t.surface = 'social_posts' AND t.row_id = sp.id
                                AND t.expires_at > now())
                THEN public.legacy_transition_eligible(sp) IS TRUE
                ELSE false END AS lte
      FROM public.social_posts sp
      JOIN aud ON aud.audience_mode IS NOT DISTINCT FROM sp.audience_mode
              AND aud.visibility IS NOT DISTINCT FROM sp.visibility
              AND aud.audience_list IS NOT DISTINCT FROM sp.audience_list
      LEFT JOIN public.video_library_videos v ON v.id = sp.source_asset_id
     WHERE sp.author_id = p_author_id
       AND COALESCE(sp.is_deleted, false) = false
       AND ((sp.author_id = v_uid) OR (sp.visibility IS DISTINCT FROM 'private'))
  ), r AS MATERIALIZED (
    SELECT b.*,
           -- Extracted once, and only for a row the cheap terms leave open.
           CASE WHEN (b.content_type IS DISTINCT FROM 'video' OR b.is_self OR b.lte)
                 AND (b.lte OR (b.origin_type <> 'video_library') IS TRUE)
                THEN NULL
                ELSE public.fn_extract_youtube_video_id(b.playback_url) END AS extracted_id
      FROM b
  )
  SELECT count(*) INTO v_n
    FROM r
   WHERE (r.content_type IS DISTINCT FROM 'video' OR r.is_self OR r.lte
          -- fn_is_public_video_playback_eligible, unfolded verbatim.
          OR (CASE
                WHEN r.playback_type = 'youtube_embed' THEN
                  r.rights_status IN ('embed_only', 'owned', 'licensed')
                  AND r.youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
                  AND r.canonical_asset_key = 'youtube:' || r.youtube_video_id
                  AND r.extracted_id = r.youtube_video_id
                  AND public.fn_has_fresh_public_youtube_verification(r.youtube_video_id)
                WHEN r.playback_type = 'native' THEN
                  r.rights_status IN ('owned', 'licensed', 'user_authorized')
                  AND public.fn_is_user_video_storage_url(r.playback_url, r.author_id)
                  AND (
                    (r.rights_status = 'user_authorized'
                     AND r.youtube_video_id IS NULL
                     AND r.canonical_asset_key LIKE 'native:%')
                    OR (r.rights_status IN ('owned', 'licensed')
                        AND (r.youtube_video_id IS NULL
                             OR (r.canonical_asset_key = 'youtube:' || r.youtube_video_id
                                 AND public.fn_has_fresh_public_youtube_verification(r.youtube_video_id)))))
                ELSE false
              END) IS TRUE)
     AND (r.lte
          OR (r.origin_type <> 'video_library') IS TRUE
          -- fn_is_video_library_lineage_eligible, unfolded verbatim.
          OR (r.asset_id IS NOT NULL
              AND r.youtube_video_id = r.asset_youtube_video_id
              AND r.canonical_asset_key = 'youtube:' || r.asset_youtube_video_id
              AND r.publication_key = 'video-library:' || r.asset_id::text
              AND r.extracted_id = r.asset_youtube_video_id
              AND public.fn_is_video_library_asset_eligible(r.asset_id)) IS TRUE);

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.fn_social_profile_post_count(uuid) IS
  'Number of an author''s social_posts the caller may see: the same answer as count(*) through the social_posts SELECT policies, computed set-wise. Refuses (55000) if the policy or an unfolded helper changes. 20261126232411.';

REVOKE ALL ON FUNCTION public.fn_social_profile_post_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_social_profile_post_count(uuid) TO anon, authenticated, service_role;

INSERT INTO public.ca_browser_definer_allowlist(proname, reason) VALUES (
  'fn_social_profile_post_count',
  'Public profile Posts number. Read-only; returns one integer: how many of one author''s social_posts the CALLER may see, decided by auth.uid() exactly as the social_posts SELECT policies decide it (same predicates, evaluated set-wise). A signed-out visitor learns only the count the public profile already shows. Writes nothing.'
) ON CONFLICT (proname) DO NOTHING;

-- PROBE: the body runs, and equals the RLS count, before COMMIT; always undone.
-- @probe-for: public.fn_social_profile_post_count
DO $probe$
DECLARE
  v_author uuid;
  v_fn     bigint;
  v_rls    bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.fn_social_profile_post_count(gen_random_uuid()) <> 0
     OR public.fn_social_profile_post_count(NULL) <> 0 THEN
    RAISE EXCEPTION 'post count probe: an author with no posts did not count 0';
  END IF;

  -- Up to 20 light authors (a schema-only rehearsal database has none): the
  -- function must equal count(*) through RLS, signed out and as the author.
  FOR v_author IN
    SELECT sp.author_id FROM public.social_posts sp
     GROUP BY sp.author_id HAVING count(*) <= 100
     ORDER BY count(*) DESC, sp.author_id
     LIMIT 20
  LOOP
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_fn := public.fn_social_profile_post_count(v_author);
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_rls FROM public.social_posts WHERE author_id = v_author;
    RESET ROLE;
    IF v_fn <> v_rls THEN
      RAISE EXCEPTION 'post count probe: anon % counted % but RLS shows %', v_author, v_fn, v_rls;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_author, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
    v_fn := public.fn_social_profile_post_count(v_author);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_rls FROM public.social_posts WHERE author_id = v_author;
    RESET ROLE;
    IF v_fn <> v_rls THEN
      RAISE EXCEPTION 'post count probe: author % counted % of their own but RLS shows %', v_author, v_fn, v_rls;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
