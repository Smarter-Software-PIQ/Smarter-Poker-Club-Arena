CREATE OR REPLACE FUNCTION public.fn_union_pnl_satellite_seat_owner(p_registration_id uuid, p_tournament_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH reg AS (
  SELECT e.after_row r FROM public.union_pnl_inventory_events e
  WHERE e.source_name='tournament_players' AND e.row_id=p_registration_id ORDER BY e.event_id LIMIT 1
 ), who AS (
  SELECT (r->>'user_id')::uuid user_id,(r->>'source_satellite_id')::uuid satellite_id,(r->>'registered_at')::timestamptz registered_at,
   (r->>'tournament_id')::uuid target_id,(r->>'club_id')::uuid admission_club_id
  FROM reg WHERE (p_tournament_id IS NULL OR r->>'tournament_id'=p_tournament_id::text)
   AND r->>'source_satellite_id' IS NOT NULL AND r->>'user_id' IS NOT NULL AND r->>'tournament_id' IS NOT NULL
 ), award AS (
  SELECT a.tournament_id,a.user_id FROM who w
  JOIN public.tournament_satellite_awards a ON a.tournament_id=w.satellite_id AND a.user_id=w.user_id
  JOIN public.tournament_satellite_settlements s ON s.tournament_id=a.tournament_id
  WHERE (a.delivery_kind='seat' AND a.registration_id=p_registration_id AND s.target_id=w.target_id)
   OR (a.delivery_kind='ticket' AND a.registration_id IS NULL AND EXISTS(
    SELECT 1 FROM public.tournament_tickets t
    WHERE t.id=a.ticket_id AND t.holder_id=w.user_id AND t.source_satellite_id=w.satellite_id
     AND t.status='redeemed' AND t.redemption_mode='tournament_entry_only' AND t.redeemed_at=w.registered_at
     AND CASE WHEN EXISTS(SELECT 1 FROM public.tournament_payouts p
       WHERE p.tournament_id=t.source_satellite_id AND p.source='satellite_ticket'
        AND p.metadata->>'ticket_id'=t.id::text AND p.metadata->>'ticket_contract'='same_value_entry_v1')
     THEN
      -- Original target remains issuance provenance. A value ticket is consumed
      -- by its one canonical atomic admission into the actual registration.
      public.fn_ca_assert_satellite_value_ticket(t.id)='chips'
      AND t.source_tournament_id=s.target_id
      AND EXISTS(SELECT 1 FROM public.tournaments target
       WHERE target.id=w.target_id AND w.admission_club_id=t.club_id
        AND (target.union_id IS NOT NULL OR target.club_id=t.club_id)
        AND public.fn_poker_diamond_tournament(target.id) IS FALSE
        AND round(COALESCE(target.buy_in_amount,0),2)+round(COALESCE(target.buy_in_fee,0),2)=t.value)
      AND (SELECT count(*) FROM public.tournament_refund_entitlements e
       JOIN public.chip_ledger l ON l.id=e.source_ledger_id
       JOIN public.tournaments target ON target.id=e.tournament_id
       CROSS JOIN LATERAL public.fn_tournament_entry_split(target.buy_in_amount,target.buy_in_fee,target.bounty_amount,
        COALESCE(target.is_bounty,false) OR COALESCE(target.is_pko,false) OR COALESCE(target.is_mystery_bounty,false)) split
       WHERE e.source_ticket_id=t.id AND e.tournament_id=w.target_id AND e.registration_id=p_registration_id
        AND e.user_id=w.user_id AND e.source_satellite_id=w.satellite_id
        AND e.entitlement_kind='tournament_ticket' AND e.charge_category='tournament_ticket'
        AND e.evidence_kind='atomic_tournament_ticket' AND e.escrow_bucket='ticket_gross'
        AND e.refund_wallet_club_id=t.club_id AND e.gross=t.value
        AND e.refund_prize>=0 AND e.refund_bounty>=0 AND e.refund_fee>=0
        AND e.refund_prize=split.prize AND e.refund_bounty=split.bounty AND e.refund_fee=split.rake AND split.charge=t.value
        AND round(e.refund_prize+e.refund_bounty+e.refund_fee,2)=t.value
        AND e.created_at=w.registered_at
        AND l.idempotency_key='ticket:'||t.id::text||':tournament:'||w.target_id::text||':entry'
        AND l.status='posted' AND l.row_hash IS NOT NULL AND l.category='ticket_redeem'
        AND l.from_type='escrow' AND l.from_entity_id=t.id
        AND l.to_type='prize_liability' AND l.to_entity_id=w.target_id
        AND l.tournament_id=w.target_id AND l.club_id=t.club_id AND l.amount=t.value
        AND l.created_at=w.registered_at
        AND l.metadata->>'kind'='tournament_entry_ticket_admission'
        AND l.metadata->>'ticket_id'=t.id::text AND l.metadata->>'user_id'=w.user_id::text
        AND l.metadata->>'registration_id'=p_registration_id::text
        AND l.metadata->>'source_tournament_id'=s.target_id::text
        AND l.metadata->>'source_satellite_id'=w.satellite_id::text
        AND (l.metadata->>'entry_prize')::numeric=e.refund_prize
        AND (l.metadata->>'entry_bounty')::numeric=e.refund_bounty
        AND (l.metadata->>'entry_fee')::numeric=e.refund_fee
        AND (SELECT count(*) FROM public.chip_transactions x
         WHERE x.transaction_type='tournament_ticket_entry' AND x.club_id=t.club_id
          AND x.from_user_id=w.user_id AND x.to_user_id IS NULL AND x.amount=t.value
          AND x.metadata->>'ticket_id'=t.id::text AND x.metadata->>'registration_id'=p_registration_id::text
          AND x.metadata->>'holder_id'=w.user_id::text
          AND x.metadata->>'target_tournament_id'=w.target_id::text
          AND x.metadata->>'entitlement_id'=e.id::text AND x.metadata->>'ledger_id'=l.id::text
          AND x.metadata->>'idempotency_key'=l.idempotency_key
          AND x.metadata->>'wallet_chips_credited'='0')=1)=1
     ELSE s.target_id=w.target_id AND t.source_tournament_id=w.target_id END))
 ), entry AS (
  SELECT count(*) n,count(DISTINCT r.funding_club_id) clubs,min(r.funding_club_id::text)::uuid club,
   count(*) FILTER(WHERE r.operation='entry') entries,
   count(*) FILTER(WHERE r.asset IS DISTINCT FROM 'chips' OR r.amount IS NULL OR r.amount<=0 OR r.funding_club_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM (SELECT row.* FROM public.chip_ledger row WHERE row.id=r.ledger_id OFFSET 0) l WHERE l.status='posted' AND l.from_type='player_wallet' AND l.from_entity_id=r.user_id
     AND l.to_type='prize_liability' AND l.to_entity_id=r.tournament_id AND l.tournament_id=r.tournament_id AND l.amount=r.amount
     AND l.club_id=r.funding_club_id AND l.category IN ('tournament_buyin','rebuy','addon') AND l.row_hash IS NOT NULL)) bad
  FROM award a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
 )
 SELECT CASE WHEN (SELECT count(*) FROM award)=1 AND e.n>0 AND e.entries>=1 AND e.clubs=1 AND e.bad=0 THEN e.club END FROM entry e
$function$
