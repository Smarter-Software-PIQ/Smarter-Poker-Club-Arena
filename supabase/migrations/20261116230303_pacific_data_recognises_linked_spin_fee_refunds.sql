-- A cancelled Spin fee is recognised at its refund timestamp, using the
-- original immutable per-player fee receipts. The Pacific history reader
-- previously looked only for receipts on the negative record itself. On Nov3
-- this refused 64 explicitly linked full refunds (-366.72), despite all 192
-- original player/club shares matching their existing negative UTC controls.
-- No wallet, ledger, fee receipt, cancellation or UTC producer is changed.
-- @live-proof: to_regprocedure('public.fn_ca_club_data_pacific_spin_refund_parts(uuid)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.fn_ca_club_data_pacific_seed(date,boolean)') AND position('fn_ca_club_data_pacific_spin_refund_parts' IN prosrc)>0)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
CREATE FUNCTION public.fn_ca_club_data_pacific_spin_refund_parts(p_record uuid)
RETURNS TABLE(player_id uuid,club_id uuid,rake_credit numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH linked AS MATERIALIZED(
 SELECT r.id,r.tournament_id,o.id original_id,o.rake_amount original_amount
 FROM public.rake_records r JOIN public.rake_records o ON o.id=CASE
 WHEN r.metadata->>'original_rake_record_id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 THEN (r.metadata->>'original_rake_record_id')::uuid END
 WHERE r.id=p_record AND r.is_tournament AND r.rake_amount<0
 AND r.source='atomic_cancel_tournament' AND r.metadata->>'kind'='spin_rake_refund'
 AND NOT ((r.metadata->>'user_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS TRUE
 AND o.is_tournament AND o.tournament_id=r.tournament_id AND o.club_id=r.club_id
 AND o.source IN('fn_spin_book_entry','fn_spin_settle_game')
 AND o.rake_amount>0 AND o.rake_amount=-r.rake_amount AND o.created_at<=r.created_at
 AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f WHERE f.rake_record_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM public.rake_attributions a WHERE a.rake_record_id=r.id)
 -- A second link to the same original makes the evidence ambiguous. Restrict
 -- this probe by the original tournament key, never scan every cash hand.
 AND NOT EXISTS(SELECT 1 FROM public.rake_records n WHERE n.tournament_id=r.tournament_id
 AND n.is_tournament AND n.id<>r.id AND n.metadata->>'original_rake_record_id'=o.id::text)
 ), receipts AS MATERIALIZED(
 SELECT f.player_id,f.club_id,f.rake_credit,l.original_amount
 FROM linked l JOIN public.accounting_tournament_fee_sources f ON f.rake_record_id=l.original_id
 ), proof AS(
 SELECT count(*) n,sum(rake_credit) amount,min(original_amount) original_amount,
 count(DISTINCT player_id) players,
 bool_and(player_id IS NOT NULL AND club_id IS NOT NULL AND rake_credit>0) valid FROM receipts)
 SELECT r.player_id,r.club_id,-r.rake_credit FROM receipts r CROSS JOIN proof p
 WHERE p.n>0 AND p.n=p.players AND p.valid AND p.amount=p.original_amount
 $$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_spin_refund_parts(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $seed$ DECLARE d text;anchor text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_club_data_pacific_seed(date,boolean)'::regprocedure);
 IF md5(d)<>'eac4002d8313e959c3e4eaaa9faa6559' THEN RAISE EXCEPTION 'PACIFIC_SPIN_REFUND_SEED_PREIMAGE_CHANGED'; END IF;
 anchor:=' ), wal AS (';
 IF position(anchor IN d)=0 THEN RAISE EXCEPTION 'PACIFIC_SPIN_REFUND_EVENT_ANCHOR_CHANGED'; END IF;
 d:=replace(d,anchor,$events$
 UNION ALL
 SELECT r.id,'TOURNAMENT'::text,r.tournament_id,f.player_id,r.created_at,f.rake_credit,0::numeric,0::numeric,f.club_id
 FROM public.rake_records r CROSS JOIN LATERAL public.fn_ca_club_data_pacific_spin_refund_parts(r.id) f
 WHERE r.created_at>=lo AND r.created_at<hi AND r.is_tournament AND r.tournament_id IS NOT NULL AND r.rake_amount<0
 ), wal AS ($events$);
 anchor:='SELECT sum(f.rake_credit) amount,count(*) n FROM public.accounting_tournament_fee_sources f WHERE f.rake_record_id=r.id';
 IF position(anchor IN d)=0 THEN RAISE EXCEPTION 'PACIFIC_SPIN_REFUND_PROOF_ANCHOR_CHANGED'; END IF;
 d:=replace(d,anchor,$proof$SELECT sum(f.rake_credit) amount,count(*) n FROM(
 SELECT f.rake_credit FROM public.accounting_tournament_fee_sources f WHERE f.rake_record_id=r.id
 UNION ALL SELECT p.rake_credit FROM public.fn_ca_club_data_pacific_spin_refund_parts(r.id) p)f$proof$);
 EXECUTE d;
END $seed$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_seed(date,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
