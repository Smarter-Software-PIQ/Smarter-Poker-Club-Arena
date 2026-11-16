-- @install-window: daily-maintenance
-- @locks: public.profiles
-- @live-proof: EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='club_arena_tos_revision' AND data_type='text' AND is_nullable='YES') AND has_column_privilege('authenticated','public.profiles','club_arena_tos_revision','SELECT') AND NOT has_column_privilege('authenticated','public.profiles','club_arena_tos_revision','UPDATE') AND has_function_privilege('service_role','public.fn_ca_accept_terms_revision(uuid,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_accept_terms_revision(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_accept_terms_revision(uuid,text)','EXECUTE') AND position('2026-11-16-87a8e57589a09136' in (SELECT prosrc FROM pg_proc WHERE oid='public.fn_ca_accept_terms_revision(uuid,text)'::regprocedure))>0
-- A timestamp for older words is not acceptance of new financial terms.
-- Install this source before the exact-revision World Hub writer and CA reader.
-- No historical acceptance is promoted and existing profile RLS stays in place.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
ALTER TABLE public.profiles ADD COLUMN club_arena_tos_revision text;
GRANT SELECT(club_arena_tos_revision) ON public.profiles TO authenticated;
REVOKE UPDATE(club_arena_tos_revision) ON public.profiles FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_ca_accept_terms_revision(p_user_id uuid,p_terms_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE accepted_at timestamptz;revision text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'terms_acceptance_service_role_required' USING ERRCODE='42501';END IF;
 IF p_user_id IS NULL OR p_terms_revision IS DISTINCT FROM '2026-11-16-87a8e57589a09136' THEN
  RAISE EXCEPTION 'current_terms_revision_required' USING ERRCODE='22023';END IF;
 SELECT p.club_arena_tos_accepted_at,p.club_arena_tos_revision INTO accepted_at,revision
 FROM public.profiles p WHERE p.id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'terms_acceptance_profile_missing' USING ERRCODE='P0002';END IF;
 IF revision IS DISTINCT FROM p_terms_revision OR accepted_at IS NULL OR NOT isfinite(accepted_at) THEN
  UPDATE public.profiles SET club_arena_tos_accepted_at=clock_timestamp(),club_arena_tos_revision=p_terms_revision
  WHERE id=p_user_id RETURNING club_arena_tos_accepted_at,club_arena_tos_revision INTO accepted_at,revision;
 END IF;
 RETURN jsonb_build_object('termsRevision',revision,'acceptedAt',accepted_at);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_accept_terms_revision(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_accept_terms_revision(uuid,text) TO service_role;
COMMIT;
