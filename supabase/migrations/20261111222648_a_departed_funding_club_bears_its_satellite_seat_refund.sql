-- 20261111222648_a_departed_funding_club_bears_its_satellite_seat_refund
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch. Incident a544b469-9226-4770-9f77-d5a77e085ea7.
--
-- THE FUNDING CLUB BEARS ITS SATELLITE SEAT REFUND (owner ruling 2026-11-11).
--
-- The question put to the owner on 2026-11-11 (~16:15 America/Chicago) was
-- "Which club's weekly P&L should carry these two refunds?". His answer,
-- verbatim: "KINGS CLUB (Recommended)", meaning: "The club that funded the
-- entry bears its refund; the Felt Society receipt is recorded as an
-- inter-club transfer."
--
-- The two refunds: cancelled tournament f4153d52, 200.00 each, ledgers
-- b9216e23 and ca27f46a (entitlements 17548750, e23baaa9). Both players
-- paid their satellite entries from KINGS CLUB a41434bb wallets (posted
-- wallet-funded entry receipts), left KINGS CLUB on 2026-11-02, won their
-- seats on 2026-11-05 as The Felt Society a0000000 registrations, and the
-- 2026-11-07 cancellation refunded each 200.00 into a Felt Society wallet.
-- 20261111010427 proved that lineage and attributed both refunds to the
-- admitted club. The ruling assigns them to the funding club instead.
--
-- The rule, in both original readers (full and bounded window):
--   * Seat owner = the club the wallet-funded entry receipt names, exactly as
--     fn_union_pnl_satellite_seat_owner(registration, target) resolves it
--     (the immediate satellite, or one proven hop upstream). Unchanged.
--   * When that club differs from the entitlement's refund wallet club and
--     the admitted-club arm has proved the whole original lineage (award,
--     settlement, payout, immutable registration, fully backed pool
--     transfer, entitlement and its one full refund tranche), the refund is
--     the FUNDING club's tournament_return.
--   * The receipt in the other club's wallet is the inter-club transfer: the
--     ledger keeps its own club_id, and the ownership predicate admits
--     owner <> ledger club only for this exact proven shape (as it already
--     does for a proven treasury gift), naming both clubs.
-- Existing flow kinds only. No ledger, wallet, membership, receipt,
-- certificate or settled payout is written; live membership is never read.
--
-- MEASURED read-only on production 2026-11-11 22:00-22:30Z: of 6,238
-- satellite_seat entitlements, exactly 3 have a resolved funding club other
-- than their refund wallet club, and only 2 were refunded (the two above);
-- no other flow in any week changes classification. The week that holds
-- them (2026-11-02..09) was settled at 2026-11-11 09:05Z, before the ruling,
-- on the admitted-club attribution; this file does not reopen or adjust it.
--
-- Pins: both readers' bodies change, so the advancement's reader pin and the
-- complete source list's three entries move in this transaction, read back
-- from the catalog (the 20261111010427 procedure). The basis generation
-- hash covers these bodies, so no certificate written before this file is
-- reused. Owner, ACL, security, config and volatility asserted unchanged.
--
-- Native PG17: scripts/ci/test-satellite-refund-funding-club-postgres.py.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND position('THE FUNDING CLUB BEARS ITS SATELLITE SEAT REFUND (owner ruling 2026-11-11)' in pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure))>0 AND position('THE FUNDING CLUB BEARS ITS SATELLITE SEAT REFUND (owner ruling 2026-11-11)' in pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE departed_funding_sources_before ON COMMIT DROP AS
 SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) old_md5,
  jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'volatility',provolatile) metadata
 FROM pg_proc p WHERE p.oid IN (
  'public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure,
  'smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure,
  'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure,
  'smarter_private.original_inventory_proof_sources_match()'::regprocedure);
DO $install$
DECLARE
 sig text; d text; changed text; old_hash text; new_hash text; r record; i integer;
 olds constant text[] := ARRAY[
$o1$te.refund_ent,te.refund_ent_user,te.refund_ent_club,late.n late_count$o1$,
$o2$   SELECT t.id refund_ent,t.user_id refund_ent_user,t.refund_wallet_club_id refund_ent_club
   FROM public.tournament_refund_entitlements t
$o2$,
$o3$   AND (owner_club::text=l->>'club_id' OR (treasury_gift->>'status'='proven' AND treasury_gift->>'ledger_id'=ledger_id::text AND treasury_gift->>'sponsor_bank_club'=l->>'club_id' AND treasury_gift->>'earning_club'=owner_club::text)) AND game_scope$o3$];
 news constant text[] := ARRAY[
$n1$te.refund_ent,te.refund_ent_user,te.refund_ent_club,te.refund_ent_wallet_club,te.refund_ent_funding_club,late.n late_count$n1$,
$n2$   -- THE FUNDING CLUB BEARS ITS SATELLITE SEAT REFUND (owner ruling 2026-11-11).
   -- A seat's owner is the club whose wallet paid the satellite entry, read
   -- from its wallet-funded entry receipt by fn_union_pnl_satellite_seat_owner.
   -- When the player has since left that club, the won seat is admitted and
   -- refunded at another club, and the arm below proves that whole original
   -- lineage. That refund is the funding club's return; the receipt in the
   -- other club's wallet is an inter-club transfer, named by
   -- refund_ent_wallet_club and admitted in the ownership predicate. No
   -- ledger, wallet or settled payout changes; live membership is never read.
   SELECT t.id refund_ent,t.user_id refund_ent_user,COALESCE(dep.club,t.refund_wallet_club_id) refund_ent_club,
    t.refund_wallet_club_id refund_ent_wallet_club,dep.club refund_ent_funding_club
   FROM public.tournament_refund_entitlements t
   LEFT JOIN LATERAL (SELECT f.club FROM (SELECT public.fn_union_pnl_satellite_seat_owner(t.registration_id,t.tournament_id) club) f
    WHERE t.entitlement_kind='satellite_seat' AND f.club IS NOT NULL AND f.club<>t.refund_wallet_club_id) dep ON true
$n2$,
$n3$   AND (owner_club::text=l->>'club_id' OR (treasury_gift->>'status'='proven' AND treasury_gift->>'ledger_id'=ledger_id::text AND treasury_gift->>'sponsor_bank_club'=l->>'club_id' AND treasury_gift->>'earning_club'=owner_club::text)
    -- INTER-CLUB TRANSFER (owner ruling 2026-11-11): a proven satellite seat
    -- refund paid into another club's wallet is its funding club's return.
    OR (k='tournament_return' AND refund_ent IS NOT NULL AND entry_id IS NULL AND credit_id IS NULL
     AND refund_ent_funding_club IS NOT NULL AND owner_club=refund_ent_funding_club AND refund_ent_club=refund_ent_funding_club
     AND refund_ent_wallet_club::text=l->>'club_id' AND refund_ent_wallet_club<>refund_ent_funding_club)) AND game_scope$n3$];
BEGIN
 IF md5(pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure))<>'06308c47fff694f221ad9a49edb05eb5'
  OR md5(pg_get_functiondef('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure))<>'8d034275835c5e733d8d6a491d313716'
  OR md5(pg_get_functiondef('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure))<>'bc9b0f8685186ee96c02b58a4dbaa1bf'
  OR md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))<>'bd0f2a87a65f3a4e70ba58a393262ca2'
  OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true
  OR position('SATELLITE REFUNDS FOLLOW THE ADMITTED CLUB (01a1c81a)' in pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'departed_funding_club_preimage_changed' USING ERRCODE='55000';
 END IF;
 FOREACH sig IN ARRAY ARRAY[
  'public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)',
  'smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);
  FOR i IN 1..3 LOOP
   IF (length(d)-length(replace(d,olds[i],'')))/length(olds[i])<>1 THEN
    RAISE EXCEPTION 'departed_funding_club_anchor_not_unique: % #%',sig,i;
   END IF;
   d:=replace(d,olds[i],news[i]);
  END LOOP;
  EXECUTE d;
  IF pg_get_functiondef(sig::regprocedure)<>d THEN
   RAISE EXCEPTION 'departed_funding_club_postimage: %',sig;
  END IF;
 END LOOP;
 -- The bounded advancement binds the complete original reader.
 old_hash:='06308c47fff694f221ad9a49edb05eb5';
 new_hash:=md5(pg_get_functiondef('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)'::regprocedure));
 sig:='public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)';
 d:=pg_get_functiondef(sig::regprocedure);
 IF (length(d)-length(replace(d,old_hash,'')))/length(old_hash)<>1 THEN
  RAISE EXCEPTION 'departed_funding_club_advance_pin_not_unique';
 END IF;
 changed:=replace(d,old_hash,new_hash); EXECUTE changed;
 IF pg_get_functiondef(sig::regprocedure)<>changed THEN RAISE EXCEPTION 'departed_funding_club_advance_postimage'; END IF;
 -- Preserve the entire source set; move only these three exact body pins.
 sig:='smarter_private.original_inventory_proof_sources_match()';
 d:=pg_get_functiondef(sig::regprocedure);
 FOR r IN SELECT * FROM departed_funding_sources_before
  WHERE signature<>'smarter_private.original_inventory_proof_sources_match()' LOOP
  old_hash:=r.old_md5;new_hash:=md5(pg_get_functiondef(r.signature::regprocedure));
  IF old_hash=new_hash OR (length(d)-length(replace(d,old_hash,'')))/length(old_hash)<>1 THEN
   RAISE EXCEPTION 'departed_funding_club_source_pin_not_unique: %',r.signature;
  END IF;
  d:=replace(d,old_hash,new_hash);
 END LOOP;
 EXECUTE d;
 IF pg_get_functiondef(sig::regprocedure)<>d OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'departed_funding_club_complete_source_set_mismatch';
 END IF;
 FOR r IN SELECT * FROM departed_funding_sources_before LOOP
  IF r.metadata IS DISTINCT FROM (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'volatility',provolatile) FROM pg_proc WHERE oid=r.signature::regprocedure) THEN
   RAISE EXCEPTION 'departed_funding_club_source_metadata_changed: %',r.signature;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p WHERE strpos(p.prosrc,r.old_md5)>0) THEN
   RAISE EXCEPTION 'departed_funding_club_left_a_stale_pin: %',r.signature;
  END IF;
 END LOOP;
END $install$;
COMMIT;
