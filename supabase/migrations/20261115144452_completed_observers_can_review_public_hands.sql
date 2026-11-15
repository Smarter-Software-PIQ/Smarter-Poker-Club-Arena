-- Completed observers may replay public records of exactly the deals they watched.
-- The original engine-owned archive transaction writes entitlements. No hot-table FKs.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
CREATE TABLE public.ca_observed_hands (
 viewer_id uuid NOT NULL, hand_id uuid NOT NULL, table_id uuid NOT NULL,
 hand_number bigint NOT NULL CHECK(hand_number>0), observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(viewer_id,table_id,hand_id)
);
CREATE INDEX ca_observed_hands_table_page ON public.ca_observed_hands(viewer_id,table_id,hand_number DESC);
CREATE INDEX ca_observed_hands_by_hand ON public.ca_observed_hands(viewer_id,hand_id,hand_number);
ALTER TABLE public.ca_observed_hands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_observed_hands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_observed_hands TO authenticated;
GRANT SELECT ON public.ca_observed_hands TO service_role;
CREATE POLICY observed_hand_read_own ON public.ca_observed_hands FOR SELECT TO authenticated USING(viewer_id=(SELECT auth.uid()));
-- table_id records the room watched; a Lightning projection may archive on a different physical host.
-- Canonical hole_cards contains public reveals only. Private ca_hand_facts and
-- called-river muck permissions remain unchanged and participant-only.
CREATE FUNCTION public.ca_table_review_hands(
 p_table_id uuid DEFAULT NULL,p_hand_ids uuid[] DEFAULT NULL,p_before bigint DEFAULT NULL,
 p_limit integer DEFAULT 50,p_game_mode text DEFAULT NULL,p_offset integer DEFAULT 0
) RETURNS SETOF public.hand_history
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH viewer AS MATERIALIZED (
   SELECT auth.uid() AS id WHERE auth.uid() IS NOT NULL
 ), reviewable AS (
   -- Participants keep the existing table/hand-number index route.
   (SELECT h.id,h.hand_number FROM public.hand_history h CROSS JOIN viewer v
    WHERE h.table_id=p_table_id
      AND h.players @> jsonb_build_array(jsonb_build_object('userId',v.id::text))
      AND (p_hand_ids IS NULL OR h.id=ANY(p_hand_ids[1:100]))
      AND (p_before IS NULL OR h.hand_number<p_before)
      AND (p_game_mode IS NULL OR (p_game_mode='cash' AND h.tournament_id IS NULL)
        OR (p_game_mode='tournament' AND h.tournament_id IS NOT NULL))
    ORDER BY h.hand_number DESC
    LIMIT greatest(1,least(coalesce(p_limit,50),200))+greatest(0,least(coalesce(p_offset,0),10000)))
   UNION
   -- Begin at this viewer's indexed receipts, never scan the global archive
   -- looking for projected Lightning rooms. Match the immutable hand number.
   (SELECT h.id,h.hand_number FROM public.ca_observed_hands r CROSS JOIN viewer v
    JOIN public.hand_history h ON h.id=r.hand_id AND h.hand_number=r.hand_number
    WHERE r.viewer_id=v.id AND r.table_id=p_table_id
      AND (p_hand_ids IS NULL OR h.id=ANY(p_hand_ids[1:100]))
      AND (p_before IS NULL OR r.hand_number<p_before)
      AND (p_game_mode IS NULL OR (p_game_mode='cash' AND h.tournament_id IS NULL)
        OR (p_game_mode='tournament' AND h.tournament_id IS NOT NULL))
    ORDER BY r.hand_number DESC
    LIMIT greatest(1,least(coalesce(p_limit,50),200))+greatest(0,least(coalesce(p_offset,0),10000)))
   UNION
   -- A direct open is bounded to at most 100 primary keys before entitlement
   -- checks. No table argument can widen this branch to the archive.
   (SELECT h.id,h.hand_number FROM public.hand_history h CROSS JOIN viewer v
    WHERE p_table_id IS NULL AND cardinality(p_hand_ids) BETWEEN 1 AND 100
      AND h.id=ANY(p_hand_ids[1:100])
      AND (p_before IS NULL OR h.hand_number<p_before)
      AND (p_game_mode IS NULL OR (p_game_mode='cash' AND h.tournament_id IS NULL)
        OR (p_game_mode='tournament' AND h.tournament_id IS NOT NULL))
      AND (h.players @> jsonb_build_array(jsonb_build_object('userId',v.id::text))
        OR EXISTS(SELECT 1 FROM public.ca_observed_hands r WHERE r.viewer_id=v.id
          AND r.hand_id=h.id AND r.hand_number=h.hand_number))
    ORDER BY h.hand_number DESC
    LIMIT greatest(1,least(coalesce(p_limit,50),200))+greatest(0,least(coalesce(p_offset,0),10000)))
 )
 SELECT h.* FROM (
   SELECT r.id,r.hand_number FROM reviewable r ORDER BY r.hand_number DESC
   LIMIT greatest(1,least(coalesce(p_limit,50),200))
   OFFSET greatest(0,least(coalesce(p_offset,0),10000))
 ) page JOIN public.hand_history h ON h.id=page.id ORDER BY page.hand_number DESC;
$$;
REVOKE ALL ON FUNCTION public.ca_table_review_hands(uuid,uuid[],bigint,integer,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ca_table_review_hands(uuid,uuid[],bigint,integer,text,integer) TO authenticated,service_role;
COMMIT;
