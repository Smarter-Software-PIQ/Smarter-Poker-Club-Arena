DO $capped$
DECLARE
  survivors integer;
  setup jsonb;
  source_id uuid;
  qualifiers uuid[];
  receipt jsonb;
  again jsonb;
  before_state jsonb;
  frozen jsonb;
  recipient uuid;
  refused boolean;
BEGIN
  FOREACH survivors IN ARRAY ARRAY[29,48] LOOP
    setup:=pg_temp.capped_value_case('cap_'||survivors,survivors,false);
    source_id:=(setup->>'tournament_id')::uuid;
    SELECT array_agg(value::uuid ORDER BY value::uuid) INTO qualifiers
      FROM jsonb_array_elements_text(setup->'qualifier_ids');
    PERFORM public.fn_materialize_satellite_entitlements_locked(source_id);
    PERFORM pg_temp.qualifier_assert(
      (SELECT count(*)=48 AND sum(ticket_value)=480 AND sum(remainder_value)=523
         FROM public.tournament_satellite_entitlements WHERE tournament_id=source_id),
      'frozen48 ticket10 entitlements retain attached523');
    SELECT jsonb_agg(to_jsonb(e) ORDER BY position) INTO frozen
      FROM public.tournament_satellite_entitlements e WHERE tournament_id=source_id;
    before_state:=pg_temp.qualifier_financial_state();
    PERFORM set_config('app.satellite_capped_awards','',true);
    refused:=false;
    BEGIN
      PERFORM public.fn_settle_satellite_qualifiers(source_id,qualifiers);
    EXCEPTION WHEN SQLSTATE '55000' THEN
      refused:=position('frozen full-ticket depth' in SQLERRM)>0
        OR position('compatible terminal owner' in SQLERRM)>0;
    END;
    PERFORM pg_temp.qualifier_assert(refused AND
      before_state=pg_temp.qualifier_financial_state(),
      'incumbent capped settlement refuses without any monetary effect');
    PERFORM set_config('app.satellite_capped_awards','v1',true);
    receipt:=public.fn_settle_satellite_qualifiers(source_id,qualifiers);
    PERFORM pg_temp.qualifier_assert(
      (receipt->>'receipt_version')::integer=3
      AND (receipt->>'ticket_award_count')::integer=48
      AND (receipt->>'pool')::numeric=1003
      AND (receipt->'remainder'->>'position')::integer=48
      AND (receipt->'remainder'->>'amount')::numeric=523,
      'cap receipt conserves48 tickets plus523');
    SELECT user_id INTO recipient FROM public.tournament_satellite_awards
      WHERE tournament_id=source_id AND place=48;
    PERFORM pg_temp.qualifier_assert(
      recipient=(receipt->'remainder'->>'user_id')::uuid
      AND (SELECT prize=533 FROM public.tournament_players
        WHERE tournament_id=source_id AND user_id=recipient),
      'final frozen award owns both ticket and attached remainder');
    PERFORM pg_temp.qualifier_assert(
      (SELECT count(*)=49 AND sum(amount)=1003 FROM public.tournament_payouts
        WHERE tournament_id=source_id)
      AND (SELECT prize_balance=0 AND prize_out=1003 AND closed_at IS NOT NULL
        FROM public.tournament_escrow WHERE tournament_id=source_id)
      AND (SELECT sum(prize)=1003 FROM public.tournament_players WHERE tournament_id=source_id),
      'all49 payout legs and caches reconcile with closed escrow');
    PERFORM pg_temp.qualifier_assert(
      frozen=(SELECT jsonb_agg(to_jsonb(e) ORDER BY position)
        FROM public.tournament_satellite_entitlements e WHERE tournament_id=source_id),
      'settlement preserves immutable frozen entitlement rows');
    before_state:=pg_temp.qualifier_financial_state();
    again:=public.fn_settle_satellite_qualifiers(source_id,qualifiers);
    PERFORM pg_temp.qualifier_assert(
      receipt=again AND before_state=pg_temp.qualifier_financial_state(),
      'same cohort retries the original receipt without another payment');
    refused:=false;
    BEGIN
      PERFORM public.fn_settle_satellite_qualifiers(source_id,
        qualifiers||md5('foreign capped qualifier')::uuid);
    EXCEPTION WHEN OTHERS THEN refused:=true;
    END;
    PERFORM pg_temp.qualifier_assert(refused AND
      before_state=pg_temp.qualifier_financial_state(),
      'foreign cohort cannot replay the settled award');
  END LOOP;
END $capped$;
