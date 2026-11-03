-- 20261102201013_agent_wallet_history_shows_ledger_only_movements
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 20:10:13 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- AN AGENT WALLET'S HISTORY SHOWS EVERY MOVEMENT IN AND OUT OF IT (owner, 2026-11-02).
-- fn_my_wallet_ledger listed only chip_transactions. Three writers move agent
-- wallet chips through chip_ledger alone, with no chip_transactions row:
-- weekly commission (club bank or upline agent wallet to agent wallet), weekly
-- rakeback paid out of an agent wallet to a player wallet, and club treasury
-- transfers. Over the 90 days to 2026-11-02, chip_ledger held 1,019 rakeback,
-- 192 commission and 3 treasury_transfer agent-wallet movements, none with a
-- chip_transactions row; every other agent-wallet category matched one 1:1.
-- An agent therefore saw a balance with no line explaining it (a 251.91
-- commission paid 2026-11-02 18:23 UTC never appeared). The reader now adds
-- exactly those three ledger-only categories, for the reader's own agent
-- wallet in this club, so no movement is listed twice.
-- @live-proof: position('agent_wallet_rakeback' IN pg_get_functiondef('public.fn_my_wallet_ledger(uuid,integer,integer)'::regprocedure))>0
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.fn_my_wallet_ledger(uuid,integer,integer)'::regprocedure)) NOT IN ('59c419c559309605fcb3e2634beb830e')
  AND position('agent_wallet_rakeback' IN pg_get_functiondef('public.fn_my_wallet_ledger(uuid,integer,integer)'::regprocedure))=0
 THEN RAISE EXCEPTION 'fn_my_wallet_ledger_preimage_changed'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_my_wallet_ledger(p_club_id uuid, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor   uuid := auth.uid();
  v_limit   int := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_role    text;
  v_chips   numeric := 0;
  v_agent_wallet numeric := 0;
  v_promo_wallet numeric := 0;
  v_total   bigint;
  v_in      numeric;
  v_out     numeric;
  v_rows    jsonb;
begin
  if v_actor is null then
    return jsonb_build_object('authorized', false, 'error', 'Not Authenticated');
  end if;

  select cm.role, coalesce(cm.chip_balance, 0) into v_role, v_chips
    from club_members cm
   where cm.club_id = p_club_id
     and cm.user_id = v_actor
     and coalesce(cm.status, 'active') in ('active', 'approved')
   limit 1;
  if v_role is null then
    if exists (select 1 from clubs c where c.id = p_club_id and c.owner_id = v_actor) then
      v_role := 'owner';
    else
      return jsonb_build_object('authorized', false,
        'error', 'You Are Not An Active Member Of This Club');
    end if;
  end if;

  select coalesce(a.agent_wallet_balance, 0), coalesce(a.promo_wallet_balance, 0)
    into v_agent_wallet, v_promo_wallet
    from agents a
   where a.club_id = p_club_id and a.user_id = v_actor;

  -- Every line: chip_transactions, plus the agent-wallet movements that are
  -- written to chip_ledger alone (weekly commission, rakeback paid from the
  -- agent wallet, club treasury transfers). No movement is in both.
  with lines as (
    select t.id, t.created_at, coalesce(t.amount, 0) as amount, t.transaction_type, t.notes,
           coalesce(t.metadata, '{}'::jsonb) as metadata, coalesce(t.is_reversed, false) as is_reversed,
           case when t.to_user_id = v_actor then 'in' else 'out' end as direction,
           t.from_user_id as from_user, t.to_user_id as to_user,
           t.to_user_id = v_actor as is_in, t.from_user_id = v_actor as is_out
      from chip_transactions t
     where t.club_id = p_club_id
       and (t.from_user_id = v_actor or t.to_user_id = v_actor)
    union all
    select l.id, l.created_at, coalesce(l.amount, 0),
           case l.category when 'commission' then 'agent_commission'
                           when 'rakeback' then 'agent_wallet_rakeback'
                           else 'agent_treasury_transfer' end,
           l.description,
           jsonb_build_object('source', 'chip_ledger', 'category', l.category,
                              'from_wallet', l.from_type, 'to_wallet', l.to_type),
           false,
           case when l.to_type = 'agent_wallet' and l.to_entity_id = v_actor then 'in' else 'out' end,
           case when l.from_type in ('agent_wallet', 'player_wallet') then l.from_entity_id end,
           case when l.to_type in ('agent_wallet', 'player_wallet') then l.to_entity_id end,
           l.to_type = 'agent_wallet' and l.to_entity_id = v_actor,
           l.from_type = 'agent_wallet' and l.from_entity_id = v_actor
      from chip_ledger l
     where l.club_id = p_club_id
       and l.status = 'posted'
       and l.category in ('commission', 'rakeback', 'treasury_transfer')
       and ((l.to_type = 'agent_wallet' and l.to_entity_id = v_actor)
         or (l.from_type = 'agent_wallet' and l.from_entity_id = v_actor))
  )
  select count(*),
         coalesce(sum(amount) filter (where is_in), 0),
         coalesce(sum(amount) filter (where is_out), 0),
         coalesce((
           select jsonb_agg(r order by r->>'created_at' desc)
             from (
               select jsonb_build_object(
                        'id', x.id,
                        'created_at', x.created_at,
                        'amount', round(x.amount, 2),
                        'transaction_type', x.transaction_type,
                        'notes', x.notes,
                        'metadata', x.metadata,
                        'is_reversed', x.is_reversed,
                        'direction', x.direction,
                        'from_name', case when x.from_user is not null then
                                       public.fn_arena_name(pf.alias, pf.username, pf.display_name,
                                                            pf.first_name, pf.last_name, pf.full_name) end,
                        'to_name', case when x.to_user is not null then
                                     public.fn_arena_name(pt.alias, pt.username, pt.display_name,
                                                          pt.first_name, pt.last_name, pt.full_name) end
                      ) as r
                 from (select * from lines order by created_at desc limit v_limit offset v_offset) x
                 left join profiles pf on pf.id = x.from_user
                 left join profiles pt on pt.id = x.to_user
             ) s
         ), '[]'::jsonb)
    into v_total, v_in, v_out, v_rows
    from lines;

  return jsonb_build_object(
    'authorized', true,
    'role', v_role,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'balances', jsonb_build_object(
      'player_wallet', round(v_chips, 2),
      'agent_wallet', round(v_agent_wallet, 2),
      'promo_wallet', round(v_promo_wallet, 2)),
    'totals', jsonb_build_object(
      'received', round(v_in, 2),
      'sent', round(v_out, 2),
      'net', round(v_in - v_out, 2)),
    'rows', v_rows);
end
$function$;
REVOKE ALL ON FUNCTION public.fn_my_wallet_ledger(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_wallet_ledger(uuid,integer,integer) TO authenticated, service_role;
COMMIT;
