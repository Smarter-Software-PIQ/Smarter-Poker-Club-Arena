-- Production ACLs (read 2026-11-06): {postgres=X/postgres[,service_role=X/postgres]}.
REVOKE ALL ON FUNCTION public.fn_gto_v31_release_evaluation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_epoch_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_matchup(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_evaluation_matchup(text,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_open_evaluation_epoch(uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_record_evaluation(uuid,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_record_evaluation(uuid,text,text,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_candidate_evaluations_valid(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_gto_v31_mark_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_mark_candidate(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_promote_dataset_epoch(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_promote_dataset_epoch(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_seal_prepared(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ca_gto_v31_certification_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ca_gto_v31_certification_status(uuid) TO authenticated, service_role;
