-- Production ACLs of the fixture functions (read 2026-11-07, read-only).
REVOKE ALL ON FUNCTION public.fn_gto_texture_class(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_texture_class(text) TO PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['fn_gto_texture_class_any(text)','fn_gto_v31_json_safe_integer(jsonb,numeric,numeric)',
    'fn_gto_v31_physical_positions_valid(jsonb)','fn_gto_v31_source_node_scalar_types_valid(jsonb)',
    'fn_gto_v31_action_specs_valid(jsonb)','fn_gto_v31_node_line_proof(text,integer,numeric,numeric)',
    'fn_gto_v31_complete_public_state(jsonb)','fn_gto_v31_source_node_v3_fields_valid(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;
