-- Reserved by scripts/reserve-migration-version.sh against protected main/worktrees.
-- The November 2 paid book exhausted its four-minute statement in the original
-- hand witness after its five changed hand windows were durably requalified.
-- Its strict linked count repeatedly fetched resolution heap rows through the
-- primary key solely to inspect scope. The existing union selector is partial
-- on proof validity and cannot serve this all-link witness. PostgreSQL 17 also
-- needs the base scope attribute for an index-only expression restriction.
-- Cover original point-join keys and compact canonical scope, never proof
-- payload. Leading a new union expression misestimated its un-analyzed CCI
-- statistics and chose a full-union scan; these existing point keys avoid that
-- dependency. No function, predicate, generation, payment or row is changed.
-- Scope averages 156 bytes in production and its canonical writer constructs six
-- scalar fields. A bounded absolute-max read timed out; no max-width claim is
-- made. The normal concurrent installer retains its 600-second build bound.
-- @live-proof: EXISTS(SELECT FROM pg_index i WHERE i.indexrelid=to_regclass('public.union_pnl_cash_links_witness_join_cover') AND i.indisvalid AND i.indisready AND i.indislive AND pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX union_pnl_cash_links_witness_join_cover ON public.union_pnl_cash_outcome_link_resolutions USING btree (table_id, hand_number) INCLUDE (game_scope)$index$)
CREATE INDEX CONCURRENTLY IF NOT EXISTS union_pnl_cash_links_witness_join_cover
 ON public.union_pnl_cash_outcome_link_resolutions (table_id,hand_number)
 INCLUDE(game_scope);
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public,smarter_private;
DO $cover$
BEGIN
 IF current_user<>'postgres'OR session_user<>'postgres'OR NULLIF(current_setting('request.jwt.claims',true),'')IS NOT NULL
  OR public.fn_platform_frozen()IS DISTINCT FROM false THEN RAISE EXCEPTION 'LINK_WITNESS_COVER_OPERATOR_OR_FREEZE_REFUSED';END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)'::regprocedure))
  IS DISTINCT FROM 'a7c22cb171d6d6548707c6aa73fada6d'
  OR smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true
  OR smarter_private.original_inventory_basis_generation()IS DISTINCT FROM 'original-inventory-245-v1:a364e4a8ab59299de12efabbfdac85eb'
 THEN RAISE EXCEPTION 'LINK_WITNESS_COVER_ORIGINAL_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE i.indexrelid=to_regclass('public.union_pnl_cash_links_witness_join_cover')
  AND i.indrelid='public.union_pnl_cash_outcome_link_resolutions'::regclass
  AND c.relowner='postgres'::regrole AND c.relkind='i'AND c.relpersistence='p'AND c.reloptions IS NULL
  AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL
  AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
  AND pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX union_pnl_cash_links_witness_join_cover ON public.union_pnl_cash_outcome_link_resolutions USING btree (table_id, hand_number) INCLUDE (game_scope)$index$)
 THEN RAISE EXCEPTION 'LINK_WITNESS_COVER_EXACT_VALID_INDEX_REQUIRED';END IF;
END$cover$;
COMMIT;
