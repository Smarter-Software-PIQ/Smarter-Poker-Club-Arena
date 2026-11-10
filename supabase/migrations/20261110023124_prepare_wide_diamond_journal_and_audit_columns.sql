-- Stage an exact bigint copy while the existing journals remain authoritative.
-- Take the two metadata locks together, immediately or not at all. No row is
-- scanned or changed during installation; immutable business columns stay intact.
-- @live-proof: to_regprocedure('public.fn_wheel_copy_wide_journal_batch(integer)') IS NOT NULL OR (SELECT atttypid='bigint'::regtype FROM pg_attribute WHERE attrelid='public.diamond_transactions'::regclass AND attname='amount')
BEGIN;
SET LOCAL lock_timeout='1s';
LOCK TABLE public.diamond_transactions,public.ca_diamond_balance_audit IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER TABLE public.diamond_transactions ADD COLUMN wheel_amount64 bigint NOT NULL DEFAULT 0, ADD COLUMN wheel_balance_after64 bigint;
ALTER TABLE public.ca_diamond_balance_audit ADD COLUMN wheel_old64 bigint, ADD COLUMN wheel_new64 bigint, ADD COLUMN wheel_delta64 bigint;

CREATE FUNCTION public.fn_wheel_copy_wide_journal_row()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_RELID='public.diamond_transactions'::regclass THEN
  NEW.wheel_amount64:=NEW.amount;
  NEW.wheel_balance_after64:=NEW.balance_after;
 ELSE
  NEW.wheel_old64:=NEW.old_diamonds;
  NEW.wheel_new64:=NEW.new_diamonds;
  NEW.wheel_delta64:=NEW.delta;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_copy_wide_journal_row() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzzz_wheel_copy_wide_journal BEFORE INSERT OR UPDATE ON public.diamond_transactions
 FOR EACH ROW EXECUTE FUNCTION public.fn_wheel_copy_wide_journal_row();
CREATE TRIGGER zzzz_wheel_copy_wide_audit BEFORE INSERT OR UPDATE ON public.ca_diamond_balance_audit
 FOR EACH ROW EXECUTE FUNCTION public.fn_wheel_copy_wide_journal_row();

-- CHECKs also bind new writes from roles which suppress ordinary triggers.
-- Prior unmatched rows remain eligible for the exact historical copy.
ALTER TABLE public.diamond_transactions ADD CONSTRAINT wheel_stage_journal_matches
 CHECK ((wheel_amount64,wheel_balance_after64) IS NOT DISTINCT FROM (amount::bigint,balance_after::bigint)) NOT VALID;
ALTER TABLE public.ca_diamond_balance_audit ADD CONSTRAINT wheel_stage_audit_matches
 CHECK ((wheel_old64,wheel_new64,wheel_delta64) IS NOT DISTINCT FROM (old_diamonds::bigint,new_diamonds::bigint,delta::bigint)) NOT VALID;

CREATE TABLE public.wheel_journal_copy_progress (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 journal_end uuid, journal_after uuid, audit_end bigint, audit_after bigint,
 journal_count bigint NOT NULL DEFAULT 0, audit_count bigint NOT NULL DEFAULT 0,
 journal_checked bigint NOT NULL DEFAULT 0,audit_checked bigint NOT NULL DEFAULT 0,
 journal_guard text NOT NULL,audit_guard text NOT NULL,
 journal_done boolean NOT NULL DEFAULT false, audit_done boolean NOT NULL DEFAULT false, verified_at timestamptz
);
ALTER TABLE public.wheel_journal_copy_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wheel_journal_copy_progress FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wheel_journal_copy_progress TO service_role;
INSERT INTO public.wheel_journal_copy_progress(journal_end,audit_end,journal_guard,audit_guard)
 SELECT (SELECT id FROM public.diamond_transactions ORDER BY id DESC LIMIT 1),
        (SELECT id FROM public.ca_diamond_balance_audit ORDER BY id DESC LIMIT 1),
        (SELECT md5(conbin::text) FROM pg_constraint WHERE conrelid='public.diamond_transactions'::regclass AND conname='wheel_stage_journal_matches'),
        (SELECT md5(conbin::text) FROM pg_constraint WHERE conrelid='public.ca_diamond_balance_audit'::regclass AND conname='wheel_stage_audit_matches');

-- One finite, retry-safe page of primary keys. The transaction changes the five
-- stage columns only. Both original journal guards and all financial fields stay
-- in place. The horizon is fixed while the dual-write triggers are installed.
CREATE FUNCTION public.fn_wheel_copy_wide_journal_batch(p_rows integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='1s' AS $$
DECLARE state public.wheel_journal_copy_progress; row_count integer; changed integer; journal_next uuid; audit_next bigint;
BEGIN
 IF p_rows IS NULL OR p_rows NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Choose 1 to 2000 rows'; END IF;
 SELECT * INTO STRICT state FROM public.wheel_journal_copy_progress WHERE id FOR UPDATE NOWAIT;
 IF NOT state.journal_done THEN
  WITH page AS MATERIALIZED (
    SELECT id FROM public.diamond_transactions WHERE id>=coalesce(state.journal_after,'00000000-0000-0000-0000-000000000000'::uuid)
     AND (state.journal_after IS NULL OR id<>state.journal_after) AND id<=state.journal_end
     ORDER BY id LIMIT p_rows
  ), copied AS (
    UPDATE public.diamond_transactions d SET wheel_amount64=d.amount,wheel_balance_after64=d.balance_after
    FROM page WHERE d.id=page.id AND (d.wheel_amount64,d.wheel_balance_after64) IS DISTINCT FROM (d.amount::bigint,d.balance_after::bigint)
    RETURNING d.id
  ) SELECT (SELECT count(*) FROM page),(SELECT id FROM page ORDER BY id DESC LIMIT 1),(SELECT count(*) FROM copied)
    INTO row_count,journal_next,changed;
  -- A separate command sees the UPDATE results. The key range, its verification
  -- and the cursor commit atomically; equality constraints protect it afterward.
  IF EXISTS(SELECT 1 FROM public.diamond_transactions d
   WHERE d.id>=coalesce(state.journal_after,'00000000-0000-0000-0000-000000000000'::uuid)
    AND (state.journal_after IS NULL OR d.id<>state.journal_after) AND d.id<=journal_next
    AND (d.wheel_amount64,d.wheel_balance_after64) IS DISTINCT FROM (d.amount::bigint,d.balance_after::bigint))
   THEN RAISE EXCEPTION 'Diamond journal page did not verify'; END IF;
  UPDATE public.wheel_journal_copy_progress SET journal_checked=journal_checked+row_count,journal_done=row_count<p_rows OR journal_next=journal_end,
   journal_count=journal_count+changed,journal_after=coalesce(journal_next,journal_after) WHERE id RETURNING * INTO state;
 ELSIF NOT state.audit_done THEN
  WITH page AS MATERIALIZED (
    SELECT id FROM public.ca_diamond_balance_audit WHERE id>=coalesce(state.audit_after,'-9223372036854775808'::bigint)
     AND (state.audit_after IS NULL OR id<>state.audit_after) AND id<=state.audit_end
     ORDER BY id LIMIT p_rows
  ), copied AS (
    UPDATE public.ca_diamond_balance_audit d SET wheel_old64=d.old_diamonds,wheel_new64=d.new_diamonds,wheel_delta64=d.delta
    FROM page WHERE d.id=page.id AND (d.wheel_old64,d.wheel_new64,d.wheel_delta64) IS DISTINCT FROM (d.old_diamonds::bigint,d.new_diamonds::bigint,d.delta::bigint)
    RETURNING d.id
  ) SELECT (SELECT count(*) FROM page),(SELECT max(id) FROM page),(SELECT count(*) FROM copied) INTO row_count,audit_next,changed;
  IF EXISTS(SELECT 1 FROM public.ca_diamond_balance_audit d
   WHERE d.id>=coalesce(state.audit_after,'-9223372036854775808'::bigint) AND (state.audit_after IS NULL OR d.id<>state.audit_after) AND d.id<=audit_next
    AND (d.wheel_old64,d.wheel_new64,d.wheel_delta64) IS DISTINCT FROM (d.old_diamonds::bigint,d.new_diamonds::bigint,d.delta::bigint))
   THEN RAISE EXCEPTION 'Diamond audit page did not verify'; END IF;
  UPDATE public.wheel_journal_copy_progress SET audit_checked=audit_checked+row_count,audit_done=row_count<p_rows OR audit_next=audit_end,
   audit_count=audit_count+changed,audit_after=coalesce(audit_next,audit_after) WHERE id RETURNING * INTO state;
 END IF;
 RETURN jsonb_build_object('complete',state.journal_done AND state.audit_done,'journal_count',state.journal_count,'audit_count',state.audit_count);
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_copy_wide_journal_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wheel_copy_wide_journal_batch(integer) TO service_role;
-- Each page was verified under the same transaction as its copy. The same
-- CHECK constraints bind later inserts and updates, including replica writes.
CREATE FUNCTION public.fn_wheel_verify_wide_journal_copy()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='1s' AS $$
DECLARE state public.wheel_journal_copy_progress;
BEGIN
 SELECT * INTO STRICT state FROM public.wheel_journal_copy_progress WHERE id FOR UPDATE NOWAIT;
 IF NOT (state.journal_done AND state.audit_done) THEN RAISE EXCEPTION 'The wide journal copy is still open'; END IF;
 IF state.journal_guard IS DISTINCT FROM (SELECT md5(conbin::text) FROM pg_constraint WHERE
    conrelid='public.diamond_transactions'::regclass AND conname='wheel_stage_journal_matches')
  OR state.audit_guard IS DISTINCT FROM (SELECT md5(conbin::text) FROM pg_constraint WHERE
    conrelid='public.ca_diamond_balance_audit'::regclass AND conname='wheel_stage_audit_matches')
  OR state.journal_count>state.journal_checked OR state.audit_count>state.audit_checked THEN
  RAISE EXCEPTION 'The verified journal coverage or its write constraints changed'; END IF;
 UPDATE public.wheel_journal_copy_progress SET verified_at=clock_timestamp() WHERE id RETURNING * INTO state;
 RETURN jsonb_build_object('verified_at',state.verified_at,'journal_count',state.journal_count,'audit_count',state.audit_count,'journal_checked',state.journal_checked,'audit_checked',state.audit_checked);
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_verify_wide_journal_copy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wheel_verify_wide_journal_copy() TO service_role;
COMMIT;
