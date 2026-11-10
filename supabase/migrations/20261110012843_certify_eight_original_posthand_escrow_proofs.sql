-- Version reserved by scripts/reserve-migration-version.sh against protected main and sibling worktrees.
-- Certify eight original completed pending-escrow hands through the sanctioned
-- immutable writer, after both permanent cash proof and independent cash/tournament
-- ECO owners are installed. These hands already completed their financial work;
-- no payout, balance, outcome, cache or invoice is rewritten. Exact source,
-- original snapshot and proof expectations refuse drift atomically.
-- Local original-component qualification proved all eight certificates and
-- unchanged consumers, raw-receipt absence, and financial fingerprints; the new
-- whole file also refuses missing owner installation without retaining writes.
-- Deployment owner must independently read and match installed snapshots before
-- protected merge. No manual replay or inferred production success is allowed.
-- @live-proof: (SELECT count(*)=8 FROM (VALUES ('4e50c9c5-5ae8-4644-b729-95c3575bf6ef'::uuid,49993921::bigint,'797a087245445c07315abde902c1b564'::text,'5da70c44e6ae41afe14d25d36b71e6e45da29c5e5da1b1f2fc465f3e8bde3587'::text), ('52b0783f-6a73-4d8c-967d-7d5c81eef77e'::uuid,49577697::bigint,'b9dfecc0ff03f1d1812a22a38d26d52d'::text,'a8a9e4589b02e33a73a76edf4de6f92cd3f21b7174b44df21d6750657e331b2e'::text), ('65fdddc8-14cc-4d26-9769-65e13cf80393'::uuid,51220907::bigint,'44d87c7b9fe09725455de7542f044aea'::text,'1ab1f50dd9e06586b1522ec0259b4b0c6799b512e066c89e432f8025dfcb71d6'::text), ('a30e2e75-da67-491e-a892-eb793b1c5d5c'::uuid,51343814::bigint,'c915d3af369d41ed3810a1901fb24ca0'::text,'c6fce22c8043a1923106af36092f9c2fa5be07cf2afa4b36987efb0d8e5c02ed'::text), ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53305378::bigint,'fbcb2bcddec0aa9f05c3e6a8380cfed3'::text,'6e85a42e20438e276d1dc413ab8bb1633d2b4fa38c55a5e6d30040ce52b6e03f'::text), ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53306760::bigint,'e1a59bad209a885d0d84f2f448da5cc3'::text,'abee93427f1f0b9c10b368b0ceb38065445ea5d002a42eaf4457f855a9ac8b38'::text), ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53313725::bigint,'27612862266846fefb71524416306887'::text,'417b1d8b2ba8265a94fc3f815e51f2487e494b59d225c8700a418585f1381e2a'::text), ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53314813::bigint,'7380130e8946b44fb7c9f8fe4dd9b7b0'::text,'1d071bfbb2e13125a27b37d1791a94c041d4d4fafd85b8a6df718467f1eef459'::text)) AS e(table_id,hand_number,proof_md5,original_sha256) JOIN smarter_private.posthand_escrow_certificates c USING(table_id,hand_number) WHERE c.original_sha256=e.original_sha256 AND md5((c.original->'proof')::text)=e.proof_md5)
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public,smarter_private;
SET LOCAL timezone='UTC';
CREATE TEMP TABLE original_eight_admission_expected(
 table_id uuid NOT NULL,hand_number bigint NOT NULL,proof_md5 text NOT NULL,original_sha256 text NOT NULL,
 PRIMARY KEY(table_id,hand_number),CHECK(proof_md5~'^[a-f0-9]{32}$'AND original_sha256~'^[a-f0-9]{64}$'))ON COMMIT DROP;
INSERT INTO original_eight_admission_expected VALUES
 ('4e50c9c5-5ae8-4644-b729-95c3575bf6ef'::uuid,49993921::bigint,'797a087245445c07315abde902c1b564'::text,'5da70c44e6ae41afe14d25d36b71e6e45da29c5e5da1b1f2fc465f3e8bde3587'::text),
 ('52b0783f-6a73-4d8c-967d-7d5c81eef77e'::uuid,49577697::bigint,'b9dfecc0ff03f1d1812a22a38d26d52d'::text,'a8a9e4589b02e33a73a76edf4de6f92cd3f21b7174b44df21d6750657e331b2e'::text),
 ('65fdddc8-14cc-4d26-9769-65e13cf80393'::uuid,51220907::bigint,'44d87c7b9fe09725455de7542f044aea'::text,'1ab1f50dd9e06586b1522ec0259b4b0c6799b512e066c89e432f8025dfcb71d6'::text),
 ('a30e2e75-da67-491e-a892-eb793b1c5d5c'::uuid,51343814::bigint,'c915d3af369d41ed3810a1901fb24ca0'::text,'c6fce22c8043a1923106af36092f9c2fa5be07cf2afa4b36987efb0d8e5c02ed'::text),
 ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53305378::bigint,'fbcb2bcddec0aa9f05c3e6a8380cfed3'::text,'6e85a42e20438e276d1dc413ab8bb1633d2b4fa38c55a5e6d30040ce52b6e03f'::text),
 ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53306760::bigint,'e1a59bad209a885d0d84f2f448da5cc3'::text,'abee93427f1f0b9c10b368b0ceb38065445ea5d002a42eaf4457f855a9ac8b38'::text),
 ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53313725::bigint,'27612862266846fefb71524416306887'::text,'417b1d8b2ba8265a94fc3f815e51f2487e494b59d225c8700a418585f1381e2a'::text),
 ('e474c3ca-ae34-4540-bb2e-6d1313228990'::uuid,53314813::bigint,'7380130e8946b44fb7c9f8fe4dd9b7b0'::text,'1d071bfbb2e13125a27b37d1791a94c041d4d4fafd85b8a6df718467f1eef459'::text);
DO $original_eight_admission$
DECLARE k record;s jsonb;r jsonb;accepted_outcome public.union_pnl_cash_outcomes;before_rows jsonb;after_rows jsonb;terms jsonb;
 sig text;expected_hash text;n integer:=0;
BEGIN
 IF current_user<>'postgres'OR session_user<>'postgres'OR NULLIF(current_setting('request.jwt.claims',true),'')IS NOT NULL
  OR public.fn_platform_frozen()IS DISTINCT FROM false THEN RAISE EXCEPTION 'ORIGINAL_EIGHT_OPERATOR_OR_FREEZE_REFUSED';END IF;
 IF(SELECT count(*)FROM original_eight_admission_expected)<>8 THEN RAISE EXCEPTION 'ORIGINAL_EIGHT_EXACT_FINITE_SET_REQUIRED';END IF;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261109234320'
  AND name='prove_all_original_posthand_pending_escrow_completions')
  OR NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261110005719'
   AND name='cash_and_tournament_eco_have_separate_original_records')THEN RAISE EXCEPTION 'ORIGINAL_EIGHT_BOTH_PROTECTED_OWNERS_MUST_BE_INSTALLED';END IF;
 FOR sig,expected_hash IN SELECT *FROM(VALUES
 ('public.fn_union_eco_components(uuid,timestamptz,timestamptz)','a011306b57345b96d58f1f86d236baf9'),
 ('public.fn_union_eco_record(uuid,timestamptz,timestamptz,uuid)','fb5cfd611583f960e63f322a2f068327'),
 ('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)','1a1a070e6a32766db137af3817defc8a'),
 ('smarter_private.union_eco_invoice_components(uuid,uuid,timestamptz,timestamptz)','e2af45bf39e2827bb4d22614a936e632'),
 ('smarter_private.union_eco_terms_for_book(uuid,timestamptz,timestamptz)','57a53cfc307edcae807fc676f63b14fe'),
 ('smarter_private.union_eco_v2_immutable()','d6d17e3fd7da549548377a777e87ea34'),
 ('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)','bc53663008b4c64d21bd68d6e5418411'),
 ('public.fn_ca_process_hand_post_commit_obligations(uuid)','8b81e8bb218cacb235832285e4fbbb24'),
 ('smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)','8f4d01a26e41dcb1cbc82c75e2c6a483'),
 ('public.fn_union_pnl_certify_posthand_escrow(uuid,bigint,text,text)','bda800236c5847110d78003a41bf45dd'),
 ('smarter_private.posthand_escrow_original_snapshot(uuid,bigint)','bc7c33d508a74b028f3614ba2d3d7c6d'),
 ('smarter_private.posthand_escrow_certified_evidence(uuid,bigint)','4484361142c05fcc70437b8d7a2b1407'),
 ('public.fn_pnl_cash_hand_evidence(uuid,bigint)','43820fe60b759bd93f6838f908122c96'))v(signature,hash)LOOP
  IF to_regprocedure(sig)IS NULL OR md5(pg_get_functiondef(to_regprocedure(sig)))IS DISTINCT FROM expected_hash THEN
   RAISE EXCEPTION 'ORIGINAL_EIGHT_EXACT_INSTALLED_SOURCE_REQUIRED';END IF;
 END LOOP;
 IF smarter_private.original_inventory_proof_sources_match()IS DISTINCT FROM true
  OR smarter_private.original_inventory_basis_generation()IS DISTINCT FROM 'original-inventory-245-v1:a364e4a8ab59299de12efabbfdac85eb'
 THEN RAISE EXCEPTION 'ORIGINAL_EIGHT_QUALIFIED_FINANCIAL_GENERATION_REQUIRED';END IF;
 IF NOT EXISTS(SELECT FROM pg_index i WHERE i.indexrelid=to_regclass('public.cash_hand_provenance_table_time_cover')
   AND i.indrelid='public.cash_hand_provenance_receipts'::regclass AND i.indisvalid AND i.indisready AND i.indislive
   AND pg_get_indexdef(i.indexrelid)='CREATE INDEX cash_hand_provenance_table_time_cover ON public.cash_hand_provenance_receipts USING btree (table_id, accepted_at, hand_number)')THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_EXACT_VALID_PREDECESSOR_COVER_REQUIRED';END IF;
 -- The two-ECO owner must really exist. Presence/history never substitutes for
 -- root's prior exact installed readback, but prevents an old cash-only close.
 IF to_regclass('smarter_private.union_eco_v2_terms')IS NULL OR to_regclass('smarter_private.union_eco_components')IS NULL
  OR to_regprocedure('public.fn_union_eco_components(uuid,timestamptz,timestamptz)')IS NULL
  OR to_regprocedure('smarter_private.union_eco_invoice_components(uuid,uuid,timestamptz,timestamptz)')IS NULL
  OR position('smarter_private.union_eco_components'IN pg_get_functiondef('public.fn_union_eco_record(uuid,timestamptz,timestamptz,uuid)'::regprocedure))=0
  OR position('smarter_private.union_eco_invoice_components'IN pg_get_functiondef('public.fn_union_issue_weekly_invoices(uuid,timestamptz,timestamptz,boolean)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_INDEPENDENT_ECO_RECORD_AND_INVOICE_WIRING_REQUIRED';END IF;
 IF EXISTS(SELECT FROM(VALUES('smarter_private.union_eco_v2_terms'),('smarter_private.union_eco_components'))v(relation)
  LEFT JOIN pg_class c ON c.oid=to_regclass(v.relation)
  WHERE c.oid IS NULL OR c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity)
  OR EXISTS(SELECT FROM(VALUES('smarter_private.union_eco_v2_terms'),('smarter_private.union_eco_components'))v(relation)
   WHERE NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid=to_regclass(v.relation)AND t.tgname='original_eco_immutable'
    AND t.tgenabled IN('O','A')AND t.tgtype=27 AND t.tgfoid='smarter_private.union_eco_v2_immutable()'::regprocedure)
    OR NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid=to_regclass(v.relation)AND t.tgname='original_eco_no_truncate'
     AND t.tgenabled IN('O','A')AND t.tgtype=34 AND t.tgfoid='smarter_private.union_eco_v2_immutable()'::regprocedure))THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_IMMUTABLE_INDEPENDENT_ECO_SCHEMA_REQUIRED';END IF;
 terms:=smarter_private.union_eco_terms_for_book('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
 IF terms IS NULL OR terms->'cash_enabled'IS DISTINCT FROM 'true'::jsonb OR terms->'tournament_enabled'IS DISTINCT FROM 'true'::jsonb
  OR(terms->>'cash_rate')::numeric IS DISTINCT FROM .10 OR(terms->>'tournament_rate')::numeric IS DISTINCT FROM .10 THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_EXPLICIT_TEN_PERCENT_EACH_TERMS_REQUIRED';END IF;
 IF EXISTS(SELECT FROM public.union_eco_ledger WHERE union_id='fade0000-0000-0000-0000-000000000001'
  AND period_start='2026-10-26 07:00Z'AND period_end='2026-11-02 08:00Z')THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_LEGACY_CASH_ONLY_RECORD_REQUIRES_RECONCILIATION';END IF;
 IF EXISTS(SELECT FROM original_eight_admission_expected k JOIN smarter_private.posthand_escrow_certificates c USING(table_id,hand_number))THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_EXISTING_CERTIFICATE_NO_REPLAY';END IF;
 -- Exact PK-scoped financial witnesses; the writer may add certificates only.
 SELECT jsonb_agg(jsonb_build_object('table_id',k.table_id,'hand_number',k.hand_number,
  'outcome',md5(to_jsonb(o)::text),'provenance',md5(to_jsonb(p)::text),
  'manifest',md5(to_jsonb(m)::text),'atomic',md5(to_jsonb(a)::text))ORDER BY k.table_id,k.hand_number)INTO before_rows
 FROM original_eight_admission_expected k JOIN public.union_pnl_cash_outcomes o USING(table_id,hand_number)
 JOIN public.cash_hand_provenance_receipts p USING(table_id,hand_number)
 JOIN public.cash_hand_participant_manifests m ON m.id=p.manifest_id
 JOIN public.hand_atomic_commits a ON a.hand_id=p.hand_id;
 IF jsonb_array_length(before_rows)IS DISTINCT FROM 8 THEN RAISE EXCEPTION 'ORIGINAL_EIGHT_COMPLETE_ORIGINALS_REQUIRED';END IF;
 FOR k IN SELECT *FROM original_eight_admission_expected ORDER BY table_id,hand_number LOOP
  s:=smarter_private.posthand_escrow_original_snapshot(k.table_id,k.hand_number);
  IF md5((s->'proof')::text)IS DISTINCT FROM k.proof_md5
   OR encode(extensions.digest(convert_to(s::text,'UTF8'),'sha256'),'hex')IS DISTINCT FROM k.original_sha256 THEN
   RAISE EXCEPTION 'ORIGINAL_EIGHT_EXPECTED_IMMUTABLE_PROOF_CHANGED';END IF;
  r:=public.fn_union_pnl_certify_posthand_escrow(k.table_id,k.hand_number,k.proof_md5,k.original_sha256);
  IF r->>'status'IS DISTINCT FROM 'certified'OR r->>'original_sha256'IS DISTINCT FROM k.original_sha256 THEN
   RAISE EXCEPTION 'ORIGINAL_EIGHT_WRITER_REFUSED';END IF;
  SELECT actual.*INTO STRICT accepted_outcome FROM public.union_pnl_cash_outcomes actual WHERE actual.table_id=k.table_id AND actual.hand_number=k.hand_number;
  IF public.fn_union_pnl_cash_outcome_accepted(accepted_outcome)IS DISTINCT FROM true
   OR public.fn_pnl_cash_hand_evidence(k.table_id,k.hand_number)->>'status'IS DISTINCT FROM 'ready' THEN
   RAISE EXCEPTION 'ORIGINAL_EIGHT_UNCHANGED_CONSUMERS_REFUSED';END IF;
  n:=n+1;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('table_id',k.table_id,'hand_number',k.hand_number,
  'outcome',md5(to_jsonb(o)::text),'provenance',md5(to_jsonb(p)::text),
  'manifest',md5(to_jsonb(m)::text),'atomic',md5(to_jsonb(a)::text))ORDER BY k.table_id,k.hand_number)INTO after_rows
 FROM original_eight_admission_expected k JOIN public.union_pnl_cash_outcomes o USING(table_id,hand_number)
 JOIN public.cash_hand_provenance_receipts p USING(table_id,hand_number)
 JOIN public.cash_hand_participant_manifests m ON m.id=p.manifest_id
 JOIN public.hand_atomic_commits a ON a.hand_id=p.hand_id;
 IF n<>8 OR before_rows IS DISTINCT FROM after_rows
  OR(SELECT count(*)FROM original_eight_admission_expected k JOIN smarter_private.posthand_escrow_certificates c USING(table_id,hand_number)
    WHERE c.original_sha256=k.original_sha256 AND md5((c.original->'proof')::text)=k.proof_md5)<>8 THEN
  RAISE EXCEPTION 'ORIGINAL_EIGHT_CERTIFICATE_OR_ORIGINAL_PRESERVATION_FAILED';END IF;
END$original_eight_admission$;
COMMIT;
