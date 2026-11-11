-- A retained hand already accepted atomically rebuilt its response from
-- stack_result, dropping the original separately protected accepted roster.
-- Return only the existing immutable capsule under its original payload hash.
-- Missing/mismatched discriminators remain unknown; no profile reconstruction,
-- settlement replay, stored payload update, or financial effect is introduced.
-- Qualified by the maintained accepted-roster native PostgreSQL contract.
-- Function-only DDL; one transaction, no hot-table lock.
-- @live-proof: (SELECT position('accepted_hand_roster_replay(a.table_id,a.hand_number,a.hand_id,a.post_commit_payload_hash)' in pg_get_functiondef('public.fn_ca_resume_hand_submission(uuid,text,uuid)'::regprocedure))>0)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $repair$
DECLARE
 sig constant text := 'public.fn_ca_resume_hand_submission(uuid,text,uuid)';
 d text;
 before_acl aclitem[];
 before_owner oid;
 before_config text[];
 old constant text := $old$  r:=a.stack_result||jsonb_build_object('success',true,'atomic_hand_commit',true,'history_id',a.hand_id,
    'commit_hash',a.payload_hash,'post_commit_obligations',true,'post_commit_payload_hash',a.post_commit_payload_hash);$old$;
 replacement constant text := $new$  r:=a.stack_result||jsonb_build_object('success',true,'atomic_hand_commit',true,'history_id',a.hand_id,
    'commit_hash',a.payload_hash,'post_commit_obligations',true,'post_commit_payload_hash',a.post_commit_payload_hash,
    'accepted_roster',smarter_private.accepted_hand_roster_replay(a.table_id,a.hand_number,a.hand_id,a.post_commit_payload_hash));$new$;
BEGIN
 SELECT pg_get_functiondef(oid),proacl,proowner,proconfig INTO d,before_acl,before_owner,before_config
 FROM pg_proc WHERE oid=sig::regprocedure AND prosecdef AND proowner='postgres'::regrole;
 IF d IS NULL OR (length(d)-length(replace(d,old,'')))/length(old)<>1
    OR position('accepted_hand_roster_replay' in d)>0 THEN
  RAISE EXCEPTION 'RETAINED_HAND_ROSTER_PREIMAGE_DRIFT';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='smarter_private.accepted_hand_roster_replay(uuid,bigint,uuid,text)'::regprocedure
   AND provolatile='s' AND NOT prosecdef AND proowner='postgres'::regrole
   AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'RETAINED_HAND_ROSTER_REPLAY_UNPROVEN';
 END IF;
 EXECUTE replace(d,old,replacement);
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=sig::regprocedure AND prosecdef
   AND proowner=before_owner AND proacl IS NOT DISTINCT FROM before_acl
   AND proconfig IS NOT DISTINCT FROM before_config AND pg_get_functiondef(oid)=replace(d,old,replacement)) THEN
  RAISE EXCEPTION 'RETAINED_HAND_ROSTER_POSTIMAGE_DRIFT';
 END IF;
END $repair$;
COMMIT;
