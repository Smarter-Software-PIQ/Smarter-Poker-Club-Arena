-- 20261115015159_union_pnl_boundary_certificates_are_kept
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15.
--
-- THE UNION'S WEEK-BOUNDARY CERTIFICATES ARE KEPT (owner specification,
-- 2026-11-14, sections 2, 5 and 11; Club Data accounting read model,
-- PR #10879, independent review finding S1)
--
-- WHAT WAS WRONG (measured on production, read-only, 2026-11-15 04:40Z):
-- a union weekly invoice's tournament player result carries the entries of
-- tournaments that had not settled at each week boundary
-- (deferred_tournament_result holdings), and the only record of those
-- holdings is the pnl_boundary row of public.accounting_close_certificates.
-- fn_accounting_close_certify deletes every certificate certified more than
-- eight days earlier each time it runs. The 2026-10-05 and 2026-10-12
-- boundaries are already gone. Still held (union Midway,
-- fade0000-0000-0000-0000-000000000001, all status 'ready'):
--
--   boundary (UTC)       certified (UTC)          holdings  deferred
--   2026-09-21 07:00     2026-11-06 22:16:01      3,945     3,938
--   2026-09-28 07:00     2026-11-07 03:06:04      3,974     3,690
--   2026-10-19 07:00     2026-11-08 00:12:11      4,864     4,274
--   2026-10-26 07:00     2026-11-10 08:42:56      3,718     2,245
--   2026-11-02 08:00     2026-11-11 01:52:19      4,658     4,364
--   2026-11-09 08:00     2026-11-11 03:43:14      1,545     1,352
--
-- The first two are already past eight days and go at the next certify run;
-- the 2026-11-02 and 2026-11-09 boundaries of the week the owner asked to be
-- reconciled go by 2026-11-19. Once gone, the Club Data read model cannot
-- place those deferred entries on the week the invoice placed them.
--
-- WHAT THIS CHANGES (no money, ledger, invoice, settlement, certificate or
-- close row is read for update, changed or deleted; the eight-day retention
-- of accounting_close_certificates is left exactly as it is):
--
--   1. public.ca_union_pnl_boundary_capture: an append-only copy of every
--      'ready' pnl_boundary certificate, value byte for byte with its md5,
--      keyed by (union, boundary, value md5) so a recertified boundary is a
--      new row and the earlier value is kept. Nothing updates or deletes it.
--   2. Every such certificate production holds now is copied, in this
--      transaction, and the count is asserted before COMMIT.
--   3. trg_ca_union_pnl_boundary_capture copies each later 'ready'
--      pnl_boundary certificate in the statement that writes it. It never
--      refuses the certificate: a copy that raises is recorded in
--      ca_union_pnl_boundary_capture_failures with the certificate's key,
--      certified_at and value (so the evidence outlives the certificate), and
--      the certificate stands.
--
-- WHICH VERSION AN INVOICE USED. Certificates are recomputed and recertified
-- after invoices are issued (measured: every held certificate was certified
-- after at least one invoice that reads its boundary). The version an issued
-- invoice used is the latest version certified at or before that invoice's
-- created_at; when no kept version qualifies, that side of the boundary is
-- not invoice-exact and a consumer must say so, never substitute a later
-- version. value keeps every key byte for byte, including
-- _original_inventory_generation (inventory_basis_cache_read strips it), so
-- identical holdings certified under two generations are two rows; consumers
-- read value->'holdings'.
--
-- A boundary absent from this table is a boundary nobody can account for;
-- the Club Data reader reports a week edge whose boundary is not here as
-- incomplete rather than placing its deferred entries anywhere.
--
-- Lock: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on
-- accounting_close_certificates for about a second. Writers (measured by the
-- review, 2026-11-15): fn_accounting_close_certify through pg_cron job 272
-- every five minutes (its hourly :40 run lasts 34-36 s), and the DELETEs of
-- smarter_private.admit_cash_funding_contracts, admit_cash_atomic_contracts,
-- admit_own_agent_source and prepare_own_agent_interpretation (none in the
-- last ten days). One attempt with a 1 s lock timeout, never a loop: a
-- refusal rolls everything back cleanly. Merge outside :38-:42 and the
-- :50-:03 UTC break. No foreign key to any table.
--
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.accounting_close_certificates c WHERE c.kind = 'pnl_boundary' AND c.period_start = c.period_end AND c.value->>'status' = 'ready' AND NOT EXISTS (SELECT 1 FROM public.ca_union_pnl_boundary_capture k WHERE (k.union_id, k.boundary, k.value_md5) = (c.union_id, c.period_start, md5(c.value::text))))
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.accounting_close_certificates'::regclass AND tgname = 'trg_ca_union_pnl_boundary_capture' AND tgenabled = 'O')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'pnl boundary capture requires the maintained installer';
  END IF;
  IF to_regclass('public.ca_union_pnl_boundary_capture') IS NOT NULL THEN
    RAISE EXCEPTION 'pnl boundary capture already installed';
  END IF;
  IF to_regclass('public.accounting_close_certificates') IS NULL THEN
    RAISE EXCEPTION 'pnl boundary capture prerequisite missing';
  END IF;
END $guard$;

CREATE TABLE public.ca_union_pnl_boundary_capture (
  union_id     uuid        NOT NULL,
  boundary     timestamptz NOT NULL,
  certified_at timestamptz NOT NULL,
  value        jsonb       NOT NULL,
  value_md5    text        NOT NULL CHECK (value_md5 = md5(value::text)),
  captured_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (union_id, boundary, value_md5)
);
COMMENT ON TABLE public.ca_union_pnl_boundary_capture IS
  'Append-only copy of every ready pnl_boundary accounting close certificate (deferred tournament entries and other holdings at a union week boundary), kept after fn_accounting_close_certify retires the certificate. A recertified boundary is a new row. The version an issued invoice used is the latest one certified at or before the invoice''s created_at; when none qualifies that side is not invoice-exact. value is byte-exact including _original_inventory_generation; read value->''holdings''. 20261115015159.';

CREATE TABLE public.ca_union_pnl_boundary_capture_failures (
  id           bigserial   PRIMARY KEY,
  union_id     uuid,
  boundary     timestamptz,
  certified_at timestamptz,
  value        jsonb,
  detail       text        NOT NULL,
  failed_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.ca_union_pnl_boundary_capture_failures IS
  'A pnl_boundary certificate whose copy raised, with its certified_at and value so the evidence outlives the certificate. The certificate itself committed. Append-only. Any row here is a defect (P0) to fix at its cause.';

ALTER TABLE public.ca_union_pnl_boundary_capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_union_pnl_boundary_capture_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_union_pnl_boundary_capture, public.ca_union_pnl_boundary_capture_failures
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ca_union_pnl_boundary_capture_failures_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

-- Append-only: a kept certificate is evidence, never edited or removed.
CREATE FUNCTION public.fn_ca_union_pnl_boundary_capture_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  RAISE EXCEPTION 'ca_union_pnl_boundary_capture is append-only';
END;
$function$;
CREATE TRIGGER ca_union_pnl_boundary_capture_immutable
  BEFORE UPDATE OR DELETE ON public.ca_union_pnl_boundary_capture
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_union_pnl_boundary_capture_immutable();
CREATE TRIGGER ca_union_pnl_boundary_capture_no_truncate
  BEFORE TRUNCATE ON public.ca_union_pnl_boundary_capture
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_union_pnl_boundary_capture_immutable();
CREATE TRIGGER ca_union_pnl_boundary_capture_failures_immutable
  BEFORE UPDATE OR DELETE ON public.ca_union_pnl_boundary_capture_failures
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_union_pnl_boundary_capture_immutable();
CREATE TRIGGER ca_union_pnl_boundary_capture_failures_no_truncate
  BEFORE TRUNCATE ON public.ca_union_pnl_boundary_capture_failures
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_union_pnl_boundary_capture_immutable();
-- Evidence holds under session_replication_role = replica too.
ALTER TABLE public.ca_union_pnl_boundary_capture ENABLE ALWAYS TRIGGER ca_union_pnl_boundary_capture_immutable;
ALTER TABLE public.ca_union_pnl_boundary_capture ENABLE ALWAYS TRIGGER ca_union_pnl_boundary_capture_no_truncate;
ALTER TABLE public.ca_union_pnl_boundary_capture_failures ENABLE ALWAYS TRIGGER ca_union_pnl_boundary_capture_failures_immutable;
ALTER TABLE public.ca_union_pnl_boundary_capture_failures ENABLE ALWAYS TRIGGER ca_union_pnl_boundary_capture_failures_no_truncate;

-- The copy of each later ready boundary certificate, in the statement that
-- writes it. Never refuses the certificate.
CREATE FUNCTION public.fn_ca_union_pnl_boundary_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET lock_timeout = '50ms' AS $function$
BEGIN
  IF NEW.kind = 'pnl_boundary' AND NEW.period_start = NEW.period_end
     AND NEW.value->>'status' = 'ready' THEN
    BEGIN
      INSERT INTO public.ca_union_pnl_boundary_capture (union_id, boundary, certified_at, value, value_md5)
      VALUES (NEW.union_id, NEW.period_start, NEW.certified_at, NEW.value, md5(NEW.value::text))
      ON CONFLICT (union_id, boundary, value_md5) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.ca_union_pnl_boundary_capture_failures (union_id, boundary, certified_at, value, detail)
      VALUES (NEW.union_id, NEW.period_start, NEW.certified_at, NEW.value, SQLSTATE || ' ' || SQLERRM);
      RAISE WARNING 'pnl boundary capture failed for % %: % %', NEW.union_id, NEW.period_start, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_union_pnl_boundary_capture(), public.fn_ca_union_pnl_boundary_capture_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_ca_union_pnl_boundary_capture
  AFTER INSERT OR UPDATE OF value, certified_at ON public.accounting_close_certificates
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_union_pnl_boundary_capture();

-- Every ready boundary certificate production holds now.
INSERT INTO public.ca_union_pnl_boundary_capture (union_id, boundary, certified_at, value, value_md5)
SELECT c.union_id, c.period_start, c.certified_at, c.value, md5(c.value::text)
  FROM public.accounting_close_certificates c
 WHERE c.kind = 'pnl_boundary' AND c.period_start = c.period_end AND c.value->>'status' = 'ready'
ON CONFLICT (union_id, boundary, value_md5) DO NOTHING;

DO $proof$
DECLARE v_held bigint; v_kept bigint;
BEGIN
  SELECT count(*) INTO v_held FROM public.accounting_close_certificates c
   WHERE c.kind = 'pnl_boundary' AND c.period_start = c.period_end AND c.value->>'status' = 'ready';
  SELECT count(*) INTO v_kept FROM public.accounting_close_certificates c
   WHERE c.kind = 'pnl_boundary' AND c.period_start = c.period_end AND c.value->>'status' = 'ready'
     AND EXISTS (SELECT 1 FROM public.ca_union_pnl_boundary_capture k
                  WHERE (k.union_id, k.boundary, k.value_md5) = (c.union_id, c.period_start, md5(c.value::text))
                    AND k.value = c.value);
  IF v_kept <> v_held THEN
    RAISE EXCEPTION 'pnl boundary capture kept % of % ready certificates', v_kept, v_held;
  END IF;
  RAISE NOTICE 'pnl boundary capture kept % ready certificate(s)', v_kept;
END $proof$;

COMMIT;
