-- Member Management reads every recorded transaction, not only cashier kinds.
-- @live-proof: to_regprocedure('public.fn_member_transaction_history(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,text)') IS NOT NULL
-- Read-only projection. Existing history-book authorization and immutable records
-- remain authoritative. Receipts take precedence over their mirrored journal leg.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
CREATE OR REPLACE FUNCTION public.fn_member_transaction_history(
 p_club_id uuid, p_scope text DEFAULT 'mine', p_person uuid DEFAULT NULL,
 p_kind text DEFAULT 'member_all', p_search text DEFAULT NULL,
 p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
 p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL,
 p_limit integer DEFAULT 25, p_before_source text DEFAULT NULL)
RETURNS TABLE(id uuid, created_at timestamptz, transaction_type text, amount numeric,
 from_user_id uuid, to_user_id uuid, notes text, metadata jsonb,
 from_name text, to_name text, entry_source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
 viewer uuid := auth.uid();
 book record;
 wanted text := nullif(btrim(coalesce(p_search,'')),'');
 wallet text := substr(p_kind,8);
 n integer := least(greatest(coalesce(p_limit,25),1),251);
 receipt_filter text;
 movement_filter text;
 query text;
BEGIN
 IF viewer IS NULL OR p_club_id IS NULL OR p_person IS NULL THEN RETURN; END IF;
 SELECT * INTO book FROM public.fn_cashier_history_book(p_club_id,viewer,p_scope,p_person);
 IF book.book IS NULL OR book.subject IS DISTINCT FROM p_person THEN RETURN; END IF;
 IF p_kind NOT IN ('member_all','member_player_wallet','member_agent_wallet',
   'member_promo_wallet','member_club_bank','member_club_promo_wallet',
   'member_union_promo_wallet','member_held_cashout')
   OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to)
   OR ((p_before_at IS NULL)<>(p_before_id IS NULL))
   OR ((p_before_at IS NULL)<>(p_before_source IS NULL))
   OR (p_before_source IS NOT NULL AND p_before_source NOT IN ('receipt','movement')) THEN
   RAISE EXCEPTION 'member_history_filter_invalid' USING ERRCODE='22023';
 END IF;
 receipt_filter := $sql$
   AND ($3::timestamptz IS NULL OR ct.created_at >= $3)
   AND ($4::timestamptz IS NULL OR ct.created_at < $4)
   AND ($5::timestamptz IS NULL OR ct.created_at < $5 OR
        (ct.created_at=$5 AND ('receipt' COLLATE "C">$7 OR ('receipt'=$7 AND ct.id<$6))))
   AND ($8='all' OR public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)=$8)
   AND ($9::text IS NULL OR EXISTS (
     SELECT 1 FROM public.profiles cp
     WHERE cp.id=CASE WHEN ct.from_user_id=$2 THEN ct.to_user_id
       WHEN ct.transaction_type='horse_treasury_funding' THEN NULL ELSE ct.from_user_id END
       AND strpos(lower(public.fn_arena_name(cp.alias,cp.username,cp.display_name,
           cp.first_name,cp.last_name,cp.full_name)),lower($9))>0))$sql$;
 movement_filter := $sql$
   AND cl.status='posted'
   AND ($3::timestamptz IS NULL OR cl.created_at >= $3)
   AND ($4::timestamptz IS NULL OR cl.created_at < $4)
   AND ($5::timestamptz IS NULL OR cl.created_at < $5 OR
        (cl.created_at=$5 AND ('movement' COLLATE "C">$7 OR ('movement'=$7 AND cl.id<$6))))
   AND ($8='all' OR CASE cl.from_type
        WHEN 'club_treasury' THEN 'club_bank' WHEN 'escrow' THEN 'held_cashout'
        WHEN 'union_wallet' THEN CASE WHEN cl.from_label='union_wallets.promo_wallet' THEN 'union_promo_wallet' ELSE 'union_wallet' END
        ELSE cl.from_type END=$8)
   AND ($9::text IS NULL OR EXISTS (
     SELECT 1 FROM public.profiles cp
     WHERE cp.id=CASE WHEN cl.from_entity_id=$2 THEN cl.to_entity_id ELSE cl.from_entity_id END
       AND strpos(lower(public.fn_arena_name(cp.alias,cp.username,cp.display_name,
           cp.first_name,cp.last_name,cp.full_name)),lower($9))>0))
   AND NOT EXISTS (
     SELECT 1 FROM public.chip_transactions ct
     WHERE ct.club_id=cl.club_id
       -- Writers commit receipt and journal together. Restored-seat receipts use
       -- the same one-minute matching boundary as the maintained statement.
       AND ct.created_at BETWEEN cl.created_at-interval '1 minute' AND cl.created_at+interval '1 minute'
       AND (
       ct.metadata->>'chip_ledger_id'=cl.id::text
       OR (cl.idempotency_key IS NOT NULL AND
          cl.idempotency_key IN (ct.metadata->>'idempotency_key',ct.metadata->>'restore_key'))
       OR (ct.created_at=cl.created_at AND abs(ct.amount)=abs(cl.amount) AND (
         (cl.correlation_id IS NOT NULL AND ct.metadata->>'op_id'=cl.correlation_id::text)
         OR ((ct.from_user_id=cl.from_entity_id OR ct.to_user_id=cl.to_entity_id)
           AND (public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata) IS NULL
                OR public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)=cl.from_type
                OR (public.fn_cashier_history_funding_wallet(ct.transaction_type,ct.metadata)='club_bank' AND cl.from_type='club_treasury'))
           AND (ct.metadata->>'destination' IS NULL OR ct.metadata->>'destination'=cl.to_type)
           AND (ct.from_user_id IS NULL OR ct.from_user_id=cl.from_entity_id
                OR ct.transaction_type IN ('club_bank_send','horse_treasury_funding','club_promo_send','promo_disbursement','union_member_send','union_promo_send'))
           AND (ct.to_user_id IS NULL OR ct.to_user_id=cl.to_entity_id
                OR ct.transaction_type IN ('club_bank_claim','admin_removal','club_bank_reversal')))))))$sql$;
 query := $sql$WITH candidates AS (
   (SELECT ct.id,ct.created_at,'receipt'::text source FROM public.chip_transactions ct
    WHERE ct.club_id=$1 AND ct.from_user_id=$2$sql$ || receipt_filter || $sql$
    ORDER BY ct.created_at DESC,ct.id DESC LIMIT $10)
   UNION ALL
   (SELECT ct.id,ct.created_at,'receipt'::text FROM public.chip_transactions ct
    WHERE ct.club_id=$1 AND ct.to_user_id=$2 AND ct.from_user_id IS DISTINCT FROM $2$sql$ || receipt_filter || $sql$
    ORDER BY ct.created_at DESC,ct.id DESC LIMIT $10)
   UNION ALL
   (SELECT cl.id,cl.created_at,'movement'::text FROM public.chip_ledger cl
    WHERE cl.club_id=$1 AND cl.from_entity_id=$2$sql$ || movement_filter || $sql$
    ORDER BY cl.created_at DESC,cl.id DESC LIMIT $10)
   UNION ALL
   (SELECT cl.id,cl.created_at,'movement'::text FROM public.chip_ledger cl
    WHERE cl.club_id=$1 AND cl.to_entity_id=$2 AND cl.from_entity_id IS DISTINCT FROM $2$sql$ || movement_filter || $sql$
    ORDER BY cl.created_at DESC,cl.id DESC LIMIT $10)
 ), page AS MATERIALIZED (
   SELECT * FROM candidates ORDER BY created_at DESC,source COLLATE "C",id DESC LIMIT $10
 ), rows AS (
   SELECT p.id,p.created_at,p.source,
     CASE WHEN ct.transaction_type='horse_treasury_funding' THEN 'club_bank_send' ELSE ct.transaction_type END kind,
     abs(ct.amount) amount,
     CASE WHEN ct.transaction_type='horse_treasury_funding' THEN NULL ELSE ct.from_user_id END f,
     ct.to_user_id t, CASE WHEN ct.notes !~* 'horse' THEN ct.notes END notes,
     CASE WHEN ct.transaction_type='horse_treasury_funding' THEN jsonb_build_object('destination',coalesce(ct.metadata->>'destination','player_wallet'))
       WHEN ct.transaction_type='promo_wallet_send' AND ct.metadata->>'actor_role' IN ('super_agent','agent','sub_agent')
       THEN ct.metadata || jsonb_build_object('promo_used_after_send',(
         SELECT sum(receipt.amount)::text FROM public.chip_transactions receipt
         WHERE receipt.club_id=ct.club_id AND receipt.to_user_id=ct.to_user_id
           AND receipt.transaction_type='promo_wallet_send'
           AND receipt.metadata->>'actor_role' IN ('super_agent','agent','sub_agent')
           AND receipt.created_at>ct.created_at-interval '168 hours'
           AND (receipt.created_at,receipt.id)<=(ct.created_at,ct.id)))
       ELSE coalesce(ct.metadata,'{}'::jsonb) END metadata
   FROM page p JOIN public.chip_transactions ct ON p.source='receipt' AND ct.id=p.id
   UNION ALL
   SELECT p.id,p.created_at,p.source,CASE WHEN cl.category ~* 'horse' THEN 'club_bank_send' ELSE cl.category END,abs(cl.amount),
     CASE WHEN cl.from_type IN ('player_wallet','agent_wallet','promo_wallet') THEN cl.from_entity_id END,
     CASE WHEN cl.to_type IN ('player_wallet','agent_wallet','promo_wallet') THEN cl.to_entity_id END,
     CASE WHEN cl.notes !~* 'horse' THEN cl.notes END,
     jsonb_build_object('history_source','movement','source',cl.from_type,'destination',cl.to_type)
   FROM page p JOIN public.chip_ledger cl ON p.source='movement' AND cl.id=p.id
 )
 SELECT r.id,r.created_at,r.kind,r.amount,r.f,r.t,r.notes,r.metadata,
   CASE WHEN pf.id IS NOT NULL THEN public.fn_arena_name(pf.alias,pf.username,pf.display_name,pf.first_name,pf.last_name,pf.full_name)
        WHEN r.source='receipt' THEN public.fn_ca_transaction_party_name('from',r.kind,r.metadata,$1,r.notes)
        ELSE CASE r.metadata->>'source' WHEN 'club_treasury' THEN 'Club Bank' WHEN 'prize_liability' THEN 'Prize Pool' WHEN 'table_stack' THEN 'Table Stack' WHEN 'escrow' THEN 'Held Cash-Out' ELSE initcap(replace(r.metadata->>'source','_',' ')) END END,
   CASE WHEN pt.id IS NOT NULL THEN public.fn_arena_name(pt.alias,pt.username,pt.display_name,pt.first_name,pt.last_name,pt.full_name)
        WHEN r.source='receipt' THEN public.fn_ca_transaction_party_name('to',r.kind,r.metadata,$1,r.notes)
        ELSE CASE r.metadata->>'destination' WHEN 'club_treasury' THEN 'Club Bank' WHEN 'prize_liability' THEN 'Prize Pool' WHEN 'table_stack' THEN 'Table Stack' WHEN 'escrow' THEN 'Held Cash-Out' ELSE initcap(replace(r.metadata->>'destination','_',' ')) END END,
   r.source
 FROM rows r LEFT JOIN public.profiles pf ON pf.id=r.f LEFT JOIN public.profiles pt ON pt.id=r.t
 ORDER BY r.created_at DESC,r.source COLLATE "C",r.id DESC$sql$;
 RETURN QUERY EXECUTE query USING p_club_id,p_person,p_from,p_to,p_before_at,p_before_id,
   p_before_source,wallet,wanted,n;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_member_transaction_history(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_member_transaction_history(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid,integer,text) TO authenticated;
COMMIT;
