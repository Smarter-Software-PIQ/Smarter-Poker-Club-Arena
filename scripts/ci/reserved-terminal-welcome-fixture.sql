  WITH expected(name,game_type,variant,tournament_type,buy_in_amount,buy_in_fee,seats,stack) AS (
    VALUES
      ('NLH Heads-Up 1','NLH','sng','SNG',0.95::numeric,0.05::numeric,2,1000),
      ('PLO4 Heads-Up 1','PLO4','sng','SNG',0.95::numeric,0.05::numeric,2,1000),
      ('NLH Heads-Up 1 Turbo','NLH','sng','SNG',0.95::numeric,0.05::numeric,2,300),
      ('PLO4 Heads-Up 1 Turbo','PLO4','sng','SNG',0.95::numeric,0.05::numeric,2,300),
      ('1 Chip Spin NLH','NLH','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO4','PLO4','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO5','PLO5','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO6','PLO6','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Deep Stack Spin NLH','NLH','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO4','PLO4','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO5','PLO5','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO6','PLO6','spin','SPIN',1::numeric,0::numeric,3,1000)
  )
  SELECT c.id,c.name,c.owner_id,c.lifecycle_status,
    (SELECT count(*) FROM public.tournaments WHERE club_id=c.id)=12
    AND (SELECT count(*) FROM public.tables WHERE club_id=c.id AND tournament_id IS NOT NULL)=12
    AND (SELECT count(DISTINCT t.name) FROM public.tournaments t JOIN expected e
      ON t.name=e.name AND upper(t.game_type)=e.game_type AND lower(t.variant)=e.variant
      AND upper(t.tournament_type::text)=e.tournament_type
      AND t.buy_in_amount=e.buy_in_amount AND t.buy_in_fee=e.buy_in_fee
      AND t.max_players=e.seats AND t.min_players=e.seats AND t.table_size=e.seats
      AND t.starting_chips=e.stack
      JOIN public.tournament_cancellation_receipts r ON r.tournament_id=t.id
      JOIN public.tables b ON b.tournament_id=t.id
      WHERE t.club_id=c.id AND t.status='CANCELLED' AND t.current_players=0
      AND t.started_at IS NULL AND t.ended_at=r.settled_at
      AND t.union_id IS NULL AND t.schedule_id IS NULL AND t.restart_source_id IS NULL
      AND t.satellite_target_id IS NULL AND t.satellite_target IS NULL
      AND r.receipt_version=2 AND r.source_player_count=0 AND r.source_seat_count=0
      AND r.refunded_count=0 AND r.refund_line_count=0 AND r.ticket_return_count=0
      AND r.zero_refund_count=0 AND r.total_refunded=0 AND r.total_ticket_returned=0
      AND r.fees_reversed=0 AND r.total_rake_before=0 AND r.total_rake_after=0
      AND r.released_seat_count=0 AND r.closed_table_count=1
      AND cardinality(r.source_player_ids)=0 AND cardinality(r.source_seat_ids)=0
      AND cardinality(r.refunded_registration_ids)=0 AND cardinality(r.ticket_return_ids)=0
      AND cardinality(r.zero_refund_registration_ids)=0 AND cardinality(r.released_seat_ids)=0
      AND cardinality(r.fee_reversal_ids)=0
      AND r.receipt->>'ok'='true' AND r.receipt->>'fully_settled'='true'
      AND r.receipt->>'status'='CANCELLED' AND r.receipt->>'tournament_id'=t.id::text
      AND b.id=ALL(r.closed_table_ids) AND cardinality(r.closed_table_ids)=1
      AND b.club_id=c.id AND b.name=t.name AND b.game_type='tournament'
      AND b.status='closed' AND b.lifecycle='closed' AND b.terminal_closed_at=t.ended_at
      AND b.current_players=0 AND b.is_deleted=false AND b.max_players=t.max_players
      AND b.union_id IS NULL AND b.cluster_id IS NULL)=12
    AND (SELECT count(*) FROM public.club_members WHERE club_id=c.id)=1
    AND EXISTS(SELECT 1 FROM public.club_members m WHERE m.club_id=c.id AND m.user_id=c.owner_id
      AND m.chip_balance=0 AND m.promo_balance=0 AND m.held_chips=0 AND m.locked_chips=0
      AND m.credit_used=0 AND m.credit_limit=0)
    AND NOT EXISTS(SELECT 1 FROM public.agents WHERE club_id=c.id)
    AS safe_terminal_template
  FROM public.clubs c JOIN auth.users u ON u.id=c.owner_id
  JOIN public.club_creation_requests request ON request.club_id=c.id AND request.user_id=c.owner_id
  WHERE c.id=$1::uuid AND c.owner_id=$2::uuid AND u.email=$3::text
    AND request.request_id=$4::uuid
    AND c.id<>ALL(ARRAY['a0000000-0000-0000-0000-000000000001'::uuid,
      'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,
      '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid,
      'fade0000-0000-0000-0000-000000000001'::uuid])
    AND u.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
    AND (c.name LIKE 'Crest Cert %' OR c.name LIKE 'Preset Crest Cert %')
    AND c.union_id IS NULL AND NOT COALESCE(c.is_union,false)
    AND NOT EXISTS(SELECT 1 FROM public.union_clubs WHERE club_id=c.id)
