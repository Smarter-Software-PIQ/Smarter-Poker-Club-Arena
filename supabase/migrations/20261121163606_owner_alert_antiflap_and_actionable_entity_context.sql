-- 20261121163606_owner_alert_antiflap_and_actionable_entity_context.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   1. Uniform anti-flap dampening across all 8 owner alert kinds in
--      public.ca_owner_page_state: adds window_started_at and pages_in_window.
--      Once a kind has paged >= 3 times within a rolling 24h window,
--      fn_ca_a_real_alert_reaches_the_owner() enforces a 6h minimum cooldown
--      from last_paged_at even when firing gaps exceed the 3h episode gap.
--   2. Actionable entity context: extracts table_id / tournament_id from
--      NEW.payload (original_event.context, original_event, or alert.labels),
--      appends a concise [table <short>] / [tournament <short>] tag when not
--      already in the summary, and records table_id, tournament_id, and
--      pages_in_24h in notification metadata.
--   3. Preserves zz_a_real_alert_reaches_the_owner strictly on
--      WHEN (NEW.status = 'firing') - zero Cleared/Resolved owner pages.
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ca_owner_page_state' AND column_name = 'pages_in_window') AND position('c_flap_cooldown' in pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure)) > 0 AND position('pages_in_24h' in pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.ca_owner_page_state
  ADD COLUMN IF NOT EXISTS window_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS pages_in_window integer NOT NULL DEFAULT 0;

DO $patch$
DECLARE
  v_page text := pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure);
  c_decl_old constant text := E'  c_reminder CONSTANT interval := interval ''12 hours'';\n';
  c_decl_new constant text := E'  c_reminder CONSTANT interval := interval ''12 hours'';\n'
    || E'  c_flap_window CONSTANT interval := interval ''24 hours'';\n'
    || E'  c_flap_threshold CONSTANT integer := 3;\n'
    || E'  c_flap_cooldown CONSTANT interval := interval ''6 hours'';\n'
    || E'  v_table_id text;\n'
    || E'  v_tournament_id text;\n'
    || E'  v_entity_tag text;\n'
    || E'  v_next_window_start timestamptz;\n'
    || E'  v_next_pages_in_window integer;\n';

  c_gate_old constant text := E'  IF NOT v_page THEN\n';
  c_gate_new constant text := E'  -- Anti-flap dampening (2026-11-21): after 3 pages in 24h, enforce a 6h\n'
    || E'  -- minimum cooldown from last_paged_at even if quiet gaps exceed 3h.\n'
    || E'  IF v_page\n'
    || E'     AND v_state.last_paged_at IS NOT NULL\n'
    || E'     AND v_state.window_started_at IS NOT NULL\n'
    || E'     AND v_now - v_state.window_started_at < c_flap_window\n'
    || E'     AND v_state.pages_in_window >= c_flap_threshold\n'
    || E'     AND v_now - v_state.last_paged_at < c_flap_cooldown THEN\n'
    || E'    v_page := false;\n'
    || E'  END IF;\n\n'
    || E'  IF NOT v_page THEN\n';

  c_loop_old constant text := E'  FOR v_rec IN\n';
  c_loop_new constant text := E'  IF v_state.window_started_at IS NULL OR v_now - v_state.window_started_at >= c_flap_window THEN\n'
    || E'    v_next_window_start := v_now;\n'
    || E'    v_next_pages_in_window := 1;\n'
    || E'  ELSE\n'
    || E'    v_next_window_start := v_state.window_started_at;\n'
    || E'    v_next_pages_in_window := COALESCE(v_state.pages_in_window, 0) + 1;\n'
    || E'  END IF;\n\n'
    || E'  v_table_id := COALESCE(\n'
    || E'    NULLIF(NEW.payload->''original_event''->''context''->>''table_id'', ''''),\n'
    || E'    NULLIF(NEW.payload->''original_event''->>''table_id'', ''''),\n'
    || E'    NULLIF(NEW.payload->''alert''->''labels''->>''table_id'', ''''));\n'
    || E'  v_tournament_id := COALESCE(\n'
    || E'    NULLIF(NEW.payload->''original_event''->''context''->>''tournament_id'', ''''),\n'
    || E'    NULLIF(NEW.payload->''original_event''->>''tournament_id'', ''''),\n'
    || E'    NULLIF(NEW.payload->''alert''->''labels''->>''tournament_id'', ''''));\n'
    || E'  v_entity_tag := concat_ws('' '',\n'
    || E'    CASE WHEN v_table_id IS NOT NULL AND position(left(v_table_id, 8) in v_summary) = 0\n'
    || E'         THEN format(''[table %s]'', left(v_table_id, 8)) END,\n'
    || E'    CASE WHEN v_tournament_id IS NOT NULL AND position(left(v_tournament_id, 8) in v_summary) = 0\n'
    || E'         THEN format(''[tournament %s]'', left(v_tournament_id, 8)) END);\n'
    || E'  IF v_entity_tag <> '''' THEN\n'
    || E'    v_summary := left(v_summary || '' '' || v_entity_tag, 320);\n'
    || E'  END IF;\n\n'
    || E'  FOR v_rec IN\n';

  c_meta_old constant text := E'''inbox_id'', NEW.id, ''held_since_last_page'', v_state.held_since_page));\n';
  c_meta_new constant text := E'''inbox_id'', NEW.id, ''held_since_last_page'', v_state.held_since_page,\n'
    || E'                         ''pages_in_24h'', v_next_pages_in_window,\n'
    || E'                         ''table_id'', v_table_id, ''tournament_id'', v_tournament_id));\n';

  c_upd_old constant text := E'         pages_sent = pages_sent + 1\n';
  c_upd_new constant text := E'         pages_sent = pages_sent + 1,\n'
    || E'         window_started_at = v_next_window_start,\n'
    || E'         pages_in_window = v_next_pages_in_window\n';

  c_once constant text := 'anchor did not match exactly once';
BEGIN
  IF (length(v_page) - length(replace(v_page, c_decl_old, ''))) / length(c_decl_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner decl %', c_once;
  END IF;
  IF (length(v_page) - length(replace(v_page, c_gate_old, ''))) / length(c_gate_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner gate %', c_once;
  END IF;
  IF (length(v_page) - length(replace(v_page, c_loop_old, ''))) / length(c_loop_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner loop %', c_once;
  END IF;
  IF (length(v_page) - length(replace(v_page, c_meta_old, ''))) / length(c_meta_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner meta %', c_once;
  END IF;
  IF (length(v_page) - length(replace(v_page, c_upd_old, ''))) / length(c_upd_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_a_real_alert_reaches_the_owner upd %', c_once;
  END IF;

  v_page := replace(v_page, c_decl_old, c_decl_new);
  v_page := replace(v_page, c_gate_old, c_gate_new);
  v_page := replace(v_page, c_loop_old, c_loop_new);
  v_page := replace(v_page, c_meta_old, c_meta_new);
  v_page := replace(v_page, c_upd_old, c_upd_new);
  EXECUTE v_page;
END
$patch$;

-- @probe-exempt: public.fn_ca_a_real_alert_reaches_the_owner trigger function invoked only by zz_a_real_alert_reaches_the_owner on operational_alert_events

COMMIT;
