-- Production ACLs of the five replaced functions (read 2026-11-02).
REVOKE ALL ON FUNCTION public.fn_gto_v31_record_evaluation(uuid,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_record_evaluation(uuid,text,text,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_mark_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_mark_candidate(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_promote_dataset(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_promote_dataset(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_candidate_evaluations_valid(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ca_gto_v31_certification_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ca_gto_v31_certification_status(uuid) TO authenticated, service_role;
