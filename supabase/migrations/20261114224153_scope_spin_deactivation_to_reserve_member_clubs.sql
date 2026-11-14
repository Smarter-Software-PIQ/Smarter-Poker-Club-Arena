-- A settled HU fixture could not return its Spin seed within the two-second
-- retirement budget. Deactivation resolved the reserve owner separately for
-- every candidate tournament across the platform. Identify the reserve's club
-- IDs once, then count its live Spins using the existing tournament club index.
-- The owner itself qualifies only when it resolves to itself (including IDs
-- without a clubs row). Every other club that points to this union qualifies.
-- @live-proof: position('t.club_id = ANY(ARRAY(' in pg_get_functiondef('public.fn_spin_deactivate(uuid,uuid)'::regprocedure)) > 0 AND position('fn_spin_reserve_owner(t.club_id)' in pg_get_functiondef('public.fn_spin_deactivate(uuid,uuid)'::regprocedure)) = 0
-- The same retirement also runs two checks for BBJ promo activity. A LIKE
-- pattern constructed from a pool row scanned 1.86 million unrelated keys.
-- Bound it with the existing text_pattern_ops index; keep the LIKE witness.
-- @live-proof: position('i.key ~>=~' in pg_get_functiondef('public.fn_get_club_welcome_package_reset_impact(uuid)'::regprocedure)) > 0 AND position('i.key ~>=~' in pg_get_functiondef('smarter_private.unwind_heads_up_fixture(uuid,uuid,uuid[])'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $patch$
DECLARE
  target regprocedure := 'public.fn_spin_deactivate(uuid,uuid)'::regprocedure;
  before_def text := pg_get_functiondef(target);
  old_predicate text := 'public.fn_spin_reserve_owner(t.club_id) = v_owner';
  new_predicate text := $predicate$t.club_id = ANY(ARRAY(
       SELECT v_owner WHERE public.fn_spin_reserve_owner(v_owner) = v_owner
       UNION ALL
       SELECT c.id FROM public.clubs c WHERE c.union_id = v_owner AND c.id <> v_owner
     ))$predicate$;
BEGIN
  IF md5(before_def) <> 'f6ec890914a09729178f7e7eb6a909de'
     OR md5(pg_get_functiondef('public.fn_spin_reserve_owner(uuid)'::regprocedure))
        <> '6c28a9dbb936d147b30ca543c573d5eb' THEN
    RAISE EXCEPTION 'Spin deactivation or reserve ownership changed; requalify lookup';
  END IF;
  EXECUTE replace(before_def, old_predicate, new_predicate);
  IF strpos(pg_get_functiondef(target), new_predicate) = 0
     OR replace(pg_get_functiondef(target), new_predicate, old_predicate) IS DISTINCT FROM before_def THEN
    RAISE EXCEPTION 'Spin deactivation lookup replacement failed';
  END IF;
END
$patch$;
DO $promo$
DECLARE
  target regprocedure;
  pool_id text;
  original text;
  prefix text;
  old_predicate text;
  new_predicate text;
BEGIN
  FOR target,pool_id IN SELECT * FROM (VALUES
    ('public.fn_get_club_welcome_package_reset_impact(uuid)'::regprocedure, 'b.id'),
    ('smarter_private.unwind_heads_up_fixture(uuid,uuid,uuid[])'::regprocedure, 'v_bbj.id')
  ) AS checks(sig, pool) LOOP
    original := pg_get_functiondef(target);
    prefix := format('''bbjpromo:''||%s::text||', pool_id);
    old_predicate := 'i.key LIKE '||prefix||''':%''';
    -- In bytewise pattern order ';' immediately follows the ':' delimiter.
    new_predicate := 'i.key ~>=~ ('||prefix||''':'') AND i.key ~<~ ('||prefix||''';'') AND '||old_predicate;
    IF (length(original)-length(replace(original,old_predicate,''))) <> length(old_predicate)
       OR strpos(original,new_predicate)>0 THEN
      RAISE EXCEPTION 'Expected one unbounded BBJ promo lookup in %',target;
    END IF;
    EXECUTE replace(original,old_predicate,new_predicate);
    IF replace(pg_get_functiondef(target),new_predicate,old_predicate) IS DISTINCT FROM original THEN
      RAISE EXCEPTION 'BBJ promo lookup replacement failed in %',target;
    END IF;
  END LOOP;
END
$promo$;
COMMIT;
