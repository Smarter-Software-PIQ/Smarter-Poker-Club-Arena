CREATE OR REPLACE FUNCTION smarter_private.rakeback_wallet_payout_complete(p_payout uuid, p_calculation bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE pp public.rakeback_period_payouts%ROWTYPE;c public.accounting_rakeback_period_calculations%ROWTYPE;
BEGIN
 SELECT*INTO pp FROM public.rakeback_period_payouts WHERE id=p_payout;
 SELECT*INTO c FROM public.accounting_rakeback_period_calculations WHERE id=p_calculation;
 IF pp.id IS NULL OR c.id IS NULL OR pp.status IS DISTINCT FROM'paid'OR pp.rakeback_period_id IS DISTINCT FROM c.period_id OR pp.club_id IS DISTINCT FROM c.club_id OR pp.user_id IS DISTINCT FROM c.player_id OR pp.payout_amount IS DISTINCT FROM c.rakeback_amount
 OR NOT EXISTS(SELECT FROM public.rakeback_periods r WHERE r.id=c.period_id AND r.status='paid')
 OR NOT EXISTS(SELECT FROM public.accounting_rakeback_wallet_contracts w WHERE w.calculation_id=c.id AND w.destination_kind='agent_wallet')THEN RETURN false;END IF;
 IF(SELECT count(*)FROM public.accounting_rakeback_wallet_transfers t WHERE t.payout_id=pp.id)<>(SELECT count(*)FROM smarter_private.rakeback_certificate_wallets(c.id)g WHERE g.owed>0)THEN RETURN false;END IF;
 RETURN NOT EXISTS(
 SELECT FROM smarter_private.rakeback_certificate_wallets(c.id)g
 LEFT JOIN public.accounting_rakeback_wallet_transfers t ON t.payout_id=pp.id AND t.payer_kind=g.payer_kind AND t.payer_entity_id=g.payer_entity AND t.destination_kind=g.destination_kind
 LEFT JOIN public.chip_ledger l ON l.id=t.ledger_id LEFT JOIN public.wallet_transactions w ON w.id=t.wallet_transaction_id
 CROSS JOIN LATERAL(SELECT CASE WHEN g.payer_kind='club'OR g.payer_user IS NULL OR(l.from_type='club_treasury'AND l.metadata->>'owner_share_payer'=g.payer_user::text)THEN'club_treasury'ELSE'agent_wallet'END kind)funded
 WHERE g.owed>0 AND(t.payout_id IS NULL OR t.calculation_id IS DISTINCT FROM c.id OR t.period_id IS DISTINCT FROM c.period_id OR t.amount IS DISTINCT FROM g.owed
 OR l.amount IS DISTINCT FROM g.owed OR l.club_id IS DISTINCT FROM c.club_id OR l.from_type IS DISTINCT FROM funded.kind OR l.from_entity_id IS DISTINCT FROM CASE WHEN funded.kind='club_treasury'THEN c.club_id ELSE g.payer_user END
 OR l.to_type IS DISTINCT FROM g.destination_kind OR l.to_entity_id IS DISTINCT FROM c.player_id OR l.category IS DISTINCT FROM'rakeback'OR l.status IS DISTINCT FROM'posted'
 OR l.idempotency_key IS DISTINCT FROM'round3-period:own-agent-v1:'||c.period_id||':payer:'||g.payer_kind||':'||g.payer_entity||':destination:'||g.destination_kind
 OR l.metadata?'certificate_kind'OR l.metadata->>'routing_version'IS DISTINCT FROM'3'
 OR l.metadata->>'accounting_scope_kind'IS DISTINCT FROM CASE WHEN c.coordinator_union_id IS NULL THEN'club'ELSE'union'END
 OR l.metadata->>'accounting_scope_id'IS DISTINCT FROM coalesce(c.coordinator_union_id,c.club_id)::text
 OR(l.metadata->>'period_start')::timestamptz IS DISTINCT FROM(c.period_start::timestamp AT TIME ZONE'America/Los_Angeles')
 OR(l.metadata->>'period_end')::timestamptz IS DISTINCT FROM((c.period_end+1)::timestamp AT TIME ZONE'America/Los_Angeles')
 OR l.metadata->>'wallet_transaction_id'IS DISTINCT FROM t.wallet_transaction_id::text
 OR l.metadata->>'paid_from'IS DISTINCT FROM funded.kind
 OR l.metadata->>'payee_role_at_transfer'IS DISTINCT FROM CASE WHEN g.destination_kind='agent_wallet'THEN'agent'ELSE'player'END
 OR l.metadata->>'wallet_destination_version'IS DISTINCT FROM'own-agent-v1'OR l.metadata->>'destination_kind'IS DISTINCT FROM g.destination_kind
 OR l.metadata->>'certificate_id'IS DISTINCT FROM c.id::text OR l.metadata->>'payout_id'IS DISTINCT FROM pp.id::text OR l.metadata->>'period_id'IS DISTINCT FROM c.period_id::text OR l.metadata->>'source_fingerprint'IS DISTINCT FROM c.source_fingerprint
 OR l.pre_from_balance-l.post_from_balance IS DISTINCT FROM g.owed OR l.post_to_balance-l.pre_to_balance IS DISTINCT FROM g.owed
 OR w.user_id IS DISTINCT FROM c.player_id OR w.type IS DISTINCT FROM'credit'OR w.amount IS DISTINCT FROM g.owed OR w.wallet_type IS DISTINCT FROM CASE WHEN g.destination_kind='agent_wallet'THEN'BUSINESS'ELSE'PLAYER'END
 OR w.category IS DISTINCT FROM'rakeback'OR w.related_entity_id IS DISTINCT FROM pp.id OR w.balance_after IS DISTINCT FROM l.post_to_balance
 OR(SELECT count(*)FROM public.settlement_invoices i WHERE i.source_ledger_id=l.id AND i.status='paid'AND i.chips_transferred AND i.message_sent AND i.net_amount=g.owed AND i.gross_amount=g.owed AND i.deductions=0)<>1));
EXCEPTION WHEN check_violation OR data_exception OR no_data_found THEN RETURN false;
END $function$
