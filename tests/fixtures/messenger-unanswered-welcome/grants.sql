-- Production's ACL on the reader, read 2026-11-18: postgres, service_role, authenticated.
REVOKE ALL ON FUNCTION public.fn_get_user_conversations(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_user_conversations(uuid,uuid) TO service_role, authenticated;
