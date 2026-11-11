-- 20261110235613_a_chained_satellite_seat_resolves_one_hop_upstream.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- A CHAINED SATELLITE SEAT RESOLVES ONE HOP UPSTREAM
-- (Reliability incident a544b469-9226-4770-9f77-d5a77e085ea7,
--  union_accounting_scheduler, union fade0000-0000-0000-0000-000000000001)
-- ============================================================================
--
-- WHAT WENT WRONG, READ FROM ROWS. The weekly close for 2026-11-02 08:00Z to
-- 2026-11-09 08:00Z will not certify its P&L basis. Its pnl_flows_problem
-- certificate holds bad = 10 of 353,520 flows, all kind='unsupported'.
--
-- All ten are cancellation refunds of satellite-won seats in ONE cancelled
-- tournament, f4153d52-f30e-402c-bda8-be30b8d1b30b, each 200.00,
-- prize_liability -> player_wallet, 2000.00 in total. Each has a valid
-- tournament_refund_entitlements row. They pass entitlement_kind
-- 'satellite_seat' and fail only this predicate in
-- fn_union_pnl_original_flow_evidence:
--     public.fn_union_pnl_satellite_seat_owner(t.registration_id,NULL)
--       = t.refund_wallet_club_id
-- because fn_union_pnl_satellite_seat_owner resolves the owning club only from
-- a wallet-funded operation='entry' funding receipt on the IMMEDIATE
-- satellite, and its entry CTE requires entries>=1.
--
-- Measured read-only on production 2026-11-10 over that tournament's 85
-- satellite_seat entitlements:
--     85 total, 75 resolve today, 8 resolve to NULL, 2 resolve to a
--     different club than the refund wallet's.
--
-- The 8 are CHAINED seats: the player was admitted to the seat-producing
-- satellite by WINNING an upstream satellite, so there is no wallet entry
-- receipt on the immediate satellite at all and the helper has nothing to read.
-- One hop upstream the evidence is unambiguous, verified for all 8:
--     exactly one operation='entry' receipt      8 of 8
--     exactly one distinct funding club          8 of 8
--     that club EQUALS refund_wallet_club_id     8 of 8
--     upstream registration names no satellite   8 of 8 (the chain ends there)
-- So the owner is READ from funding evidence, not guessed.
--
-- The remaining 2 are a different thing and are deliberately NOT touched here:
-- a proper wallet entry resolves cleanly to KINGS CLUB, but both players left
-- that club before the refund and the 200.00 was paid into another club, so
-- that is a real inter-club value movement whose accounting treatment is an
-- owner decision. They stay 'unsupported'.
--
-- WHY THE HELPER AND NOT THE PREDICATE. fn_union_pnl_satellite_seat_owner has
-- seven callers, and fn_union_pnl_evidence_report's own touched step calls it
-- too (its satellite_owners CTE). Patching the flows predicate alone would
-- leave the same eight registrations resolving to NULL there, so the identical
-- evidence gap would resurface as
-- tournament_original_population_or_instrument_incomplete instead of
-- 'unsupported'. The helper's contract already is "which club owns this
-- satellite seat, from funding evidence"; how the player reached the
-- seat-producing satellite is part of that resolution. One change closes every
-- path, and it is additive, not a weakening of any predicate.
--
-- TERMINATION, AND WHY IT CANNOT OVERRIDE A GOOD ANSWER. Exactly one hop, as a
-- non-recursive CTE, never a loop:
--   * the hop is consulted ONLY when the immediate satellite has NO entry
--     receipt at all (entries = 0), so a resolvable or a conflicting immediate
--     answer is never replaced;
--   * it is accepted ONLY when the upstream registration's own captured row
--     names no satellite, so a two-hop chain resolves to NULL and stays
--     'unsupported' rather than being guessed;
--   * the upstream receipts face the IDENTICAL quality conjunction as the
--     immediate ones (single club, entries>=1, bad=0, posted chip_ledger row
--     matching on wallet, tournament, amount, club, category and row_hash).
-- is_satellite_qualifier is deliberately not used: that key is absent from
-- union_pnl_inventory_events.after_row for these registrations, so it cannot
-- be read from captured evidence. The chain link is read from the same
-- first-event provenance the existing reg CTE uses; the live
-- tournament_players row is only the unique (tournament_id,user_id) key used
-- to find those events, so a later edit to it can only make this NULL.
--
-- BLAST RADIUS, measured table-wide over all 6,104 satellite_seat
-- entitlements: 1,170 have the gate open (no entry receipt on the immediate
-- satellite) and 4,934 are untouched by construction. 22 rows across 5
-- tournaments turn NULL into a club that matches their refund wallet club.
-- ZERO currently-valid answers change. No money, seat, schedule or release is
-- touched, and no cron, watcher or repair loop is added.
--
-- @live-proof: position('CHAINED SATELLITE SEATS (20261110235613)' in pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) > 0 AND (SELECT count(*) FROM public.tournament_refund_entitlements t WHERE t.tournament_id = 'f4153d52-f30e-402c-bda8-be30b8d1b30b' AND t.entitlement_kind = 'satellite_seat' AND public.fn_union_pnl_satellite_seat_owner(t.registration_id, NULL) = t.refund_wallet_club_id) = 83

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) <> '58b6c79c412a9e3b26104c0b4b6878d6' THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_PREIMAGE_CHANGED: fn_union_pnl_satellite_seat_owner was edited since this patch was qualified; requalify before installing';
  END IF;
  IF (SELECT count(*) FROM public.tournament_refund_entitlements t
       WHERE t.tournament_id = 'f4153d52-f30e-402c-bda8-be30b8d1b30b'
         AND t.entitlement_kind = 'satellite_seat'
         AND public.fn_union_pnl_satellite_seat_owner(t.registration_id, NULL) = t.refund_wallet_club_id) <> 75 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_PREIMAGE_CHANGED: the measured baseline of 75 resolving entitlements no longer holds';
  END IF;
END
$pre$;

DO $owner$
DECLARE
  s text;
  n text;
  k integer;
  c_sig constant text := 'public.fn_union_pnl_satellite_seat_owner(uuid,uuid)';
  c_old constant text := $old$  FROM award a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
 )
 SELECT CASE WHEN (SELECT count(*) FROM award)=1 AND e.n>0 AND e.entries>=1 AND e.clubs=1 AND e.bad=0 THEN e.club END FROM entry e$old$;
  c_new constant text := $new$  FROM award a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
 -- CHAINED SATELLITE SEATS (20261110235613): a seat produced by a satellite the
 -- player was admitted to by WINNING an upstream satellite has no wallet entry
 -- receipt of its own, so 'entry' above keeps nothing and the seat's owning
 -- club was unresolvable. One hop, never two, and never recursive: the hop is
 -- taken only when the immediate satellite has NO entry receipt at all
 -- (e.entries=0), so a resolvable or a conflicting immediate answer is never
 -- overridden, and it is accepted only when the upstream registration's own
 -- original row names no satellite, so the walk must terminate at a wallet
 -- entry or resolve nothing. Both registrations are read from
 -- union_pnl_inventory_events (the same first-event provenance as 'reg'); the
 -- live tournament_players row is only the unique (tournament,user) key used
 -- to find them, and a later edit to it can only make this NULL. The upstream
 -- receipts face the identical quality conjunction, byte for byte.
 ), upstream AS (
  SELECT u.tournament_id upstream_id,w.user_id FROM who w
  JOIN public.tournament_players s ON s.tournament_id=w.satellite_id AND s.user_id=w.user_id
  CROSS JOIN LATERAL (SELECT e.after_row r FROM public.union_pnl_inventory_events e
   WHERE e.source_name='tournament_players' AND e.row_id=s.id ORDER BY e.event_id LIMIT 1) sreg
  JOIN public.tournament_players u ON u.tournament_id=(sreg.r->>'source_satellite_id')::uuid AND u.user_id=w.user_id
  CROSS JOIN LATERAL (SELECT e.after_row r FROM public.union_pnl_inventory_events e
   WHERE e.source_name='tournament_players' AND e.row_id=u.id ORDER BY e.event_id LIMIT 1) ureg
  WHERE (SELECT e.entries FROM entry e)=0 AND (SELECT count(*) FROM award)=1
   AND sreg.r->>'tournament_id'=w.satellite_id::text AND sreg.r->>'user_id'=w.user_id::text
   AND sreg.r->>'source_satellite_id' IS NOT NULL
   AND ureg.r->>'tournament_id'=sreg.r->>'source_satellite_id' AND ureg.r->>'user_id'=w.user_id::text
   AND ureg.r->>'source_satellite_id' IS NULL
   AND EXISTS(SELECT 1 FROM public.tournament_satellite_awards a WHERE a.tournament_id=u.tournament_id AND a.user_id=w.user_id)
 ), upstream_entry AS (
  SELECT count(*) n,count(DISTINCT r.funding_club_id) clubs,min(r.funding_club_id::text)::uuid club,
   count(*) FILTER(WHERE r.operation='entry') entries,
   count(*) FILTER(WHERE r.asset IS DISTINCT FROM 'chips' OR r.amount IS NULL OR r.amount<=0 OR r.funding_club_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM (SELECT row.* FROM public.chip_ledger row WHERE row.id=r.ledger_id OFFSET 0) l WHERE l.status='posted' AND l.from_type='player_wallet' AND l.from_entity_id=r.user_id
     AND l.to_type='prize_liability' AND l.to_entity_id=r.tournament_id AND l.tournament_id=r.tournament_id AND l.amount=r.amount
     AND l.club_id=r.funding_club_id AND l.category IN ('tournament_buyin','rebuy','addon') AND l.row_hash IS NOT NULL)) bad
  FROM upstream x JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=x.upstream_id AND r.user_id=x.user_id
 )
 SELECT CASE WHEN (SELECT count(*) FROM award)=1 AND e.n>0 AND e.entries>=1 AND e.clubs=1 AND e.bad=0 THEN e.club
  WHEN (SELECT count(*) FROM award)=1 AND e.entries=0 AND (SELECT count(*) FROM upstream)=1
   AND x.n>0 AND x.entries>=1 AND x.clubs=1 AND x.bad=0 THEN x.club END
 FROM entry e CROSS JOIN upstream_entry x$new$;
BEGIN
  s := pg_get_functiondef(c_sig::regprocedure);
  k := (length(s) - length(replace(s, c_old, ''))) / length(c_old);
  IF k IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_ANCHOR: tail found % times; requalify before installing', k;
  END IF;
  n := replace(s, c_old, c_new);
  IF n = s THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_ANCHOR: patch did not change the function';
  END IF;
  EXECUTE n;
END
$owner$;

DO $post$
DECLARE v_resolved integer; v_null integer; v_mismatch integer;
BEGIN
  IF position('CHAINED SATELLITE SEATS (20261110235613)' in
              pg_get_functiondef('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_POSTIMAGE: the marker is not in the installed function';
  END IF;
  SELECT count(*) FILTER (WHERE o = t.refund_wallet_club_id),
         count(*) FILTER (WHERE o IS NULL),
         count(*) FILTER (WHERE o IS NOT NULL AND o <> t.refund_wallet_club_id)
    INTO v_resolved, v_null, v_mismatch
    FROM public.tournament_refund_entitlements t
    CROSS JOIN LATERAL (SELECT public.fn_union_pnl_satellite_seat_owner(t.registration_id, NULL) o) z
   WHERE t.tournament_id = 'f4153d52-f30e-402c-bda8-be30b8d1b30b'
     AND t.entitlement_kind = 'satellite_seat';
  IF v_resolved <> 83 OR v_null <> 0 OR v_mismatch <> 2 THEN
    RAISE EXCEPTION 'SATELLITE_SEAT_OWNER_POSTIMAGE: expected 83 resolved / 0 null / 2 mismatch, got % / % / %', v_resolved, v_null, v_mismatch;
  END IF;
END
$post$;

COMMIT;
