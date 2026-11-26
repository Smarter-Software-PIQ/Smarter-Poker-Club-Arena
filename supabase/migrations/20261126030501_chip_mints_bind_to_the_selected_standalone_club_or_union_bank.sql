-- Cashier mint authorization at the selected bank. An operator of a union could
-- previously supply any member club ID and silently mint to the union bank.
-- The daily bank and the issuer now ask the same question. A member association
-- or its mirror blocks the club path; only the union's own hub ID opens its bank.
-- Serialize a new union admission with a mint before checking that the club is
-- empty. No real balance, membership, opening grant or issuance receipt is changed
-- during installation. The existing rate, debit, journal and treasury code remains.
-- @replaces-md5: public.fn_mint_chips_from_diamonds(uuid,numeric,uuid)=33fee99d88bb3c59472a9562e023f0d1
-- @replaces-md5: public.fn_enforce_club_enters_union_empty()=85078766847a937bedfc4b2ab655b6cf
-- @live-proof: md5(pg_get_functiondef('public.fn_mint_chips_from_diamonds(uuid,numeric,uuid)'::regprocedure)) = '8ec4f50babb062f9dcb77bf26689581f' AND md5(pg_get_functiondef('public.fn_cashier_mint_scope(uuid)'::regprocedure)) = '813bfe249f9a8b7284273a14257da86c' AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_enforce_club_enters_union_empty()'::regprocedure) = 'dec7ef99e8aa4a429fa22bf5145c8471' AND NOT has_function_privilege('anon','public.fn_cashier_mint_scope(uuid)','EXECUTE') AND has_function_privilege('authenticated','public.fn_cashier_mint_scope(uuid)','EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '12s';

CREATE OR REPLACE FUNCTION public.fn_cashier_mint_scope(p_club_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $scope$
  SELECT CASE
    WHEN c.is_union IS TRUE THEN
      CASE WHEN (c.union_id IS NULL OR c.union_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM public.union_clubs uc WHERE uc.club_id = c.id AND uc.union_id <> c.id)
        AND EXISTS (
          SELECT 1 FROM public.unions u WHERE u.id = c.id AND
          (u.owner_id = auth.uid() OR EXISTS (
            SELECT 1 FROM public.union_admins ua WHERE ua.union_id = u.id AND ua.user_id = auth.uid()
          ))
        ) THEN 'union' END
    WHEN c.is_union IS NOT TRUE AND c.union_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.union_clubs uc WHERE uc.club_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.unions u WHERE u.id = c.id)
      AND (c.owner_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.club_members cm WHERE cm.club_id = c.id AND cm.user_id = auth.uid()
          AND cm.role IN ('owner','co_owner','admin') AND coalesce(cm.status, 'active') IN ('active','approved')
      )) THEN 'club'
    END
  FROM public.clubs c WHERE c.id = p_club_id AND auth.uid() IS NOT NULL
$scope$;
REVOKE ALL ON FUNCTION public.fn_cashier_mint_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cashier_mint_scope(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_mint_chips_from_diamonds(p_club_id uuid, p_diamonds numeric, p_op_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_op_id uuid := coalesce(p_op_id, gen_random_uuid());
  v_prior record;
  v_diamonds numeric;
  v_chips numeric;
  v_rate integer;
  v_deduct jsonb;
  v_diamonds_after numeric;
  v_club record;
  v_scope text;
  v_pool_after numeric;
  v_union_bank_after numeric;
begin
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Not Authenticated');
  end if;
  if p_diamonds is null or p_diamonds <= 0 or p_diamonds <> floor(p_diamonds) then
    return jsonb_build_object('success', false, 'error', 'Diamonds Must Be A Positive Whole Number');
  end if;
  if p_diamonds > 1000000 then
    return jsonb_build_object('success', false, 'error', 'Maximum 1,000,000 Diamonds Per Mint');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || v_op_id::text, 0));

  select amount, from_user_id, metadata, balance_after into v_prior
    from chip_transactions
   where transaction_type = 'mint'
     and club_id = p_club_id
     and metadata ->> 'op_id' = v_op_id::text
   limit 1;
  if found then
    if v_prior.from_user_id is distinct from v_actor
       or (v_prior.metadata ->> 'diamonds_spent')::numeric is distinct from p_diamonds then
      return jsonb_build_object('success', false, 'error', 'This Mint Reference Belongs To A Different Request');
    end if;
    return jsonb_build_object('success', true, 'replayed', true,
      'scope', v_prior.metadata ->> 'scope',
      'chips', v_prior.amount,
      'diamonds_spent', (v_prior.metadata ->> 'diamonds_spent')::numeric,
      'diamonds_after', (select coalesce(diamonds, 0) from profiles where id = v_actor),
      'club_pool_after', case when (v_prior.metadata ->> 'scope') = 'club'
                              then v_prior.balance_after end,
      'union_bank_after', case when (v_prior.metadata ->> 'scope') = 'union'
                               then v_prior.balance_after end);
  end if;

  v_diamonds := p_diamonds;
  -- THE RATE IS A ROW (Dan 2026-09-07: 1 diamond = $0.01, 1 chip = $1.00).
  -- Read from ca_bridge_rate; never a literal in this body again.
  v_rate := public.fn_ca_bridge_rate();
  if v_rate is null or v_rate <= 0 then
    return jsonb_build_object('success', false, 'error', 'The Bridge Rate Is Not Set');
  end if;
  v_chips := round(v_diamonds / v_rate, 2);
  if v_chips <= 0 or v_chips * v_rate <> v_diamonds then
    return jsonb_build_object('success', false,
      'error', format('Diamonds Must Convert To Whole Cents Of Chips At %s Diamonds Per Chip', v_rate));
  end if;

  select id into v_club
    from clubs where id = p_club_id for update;
  if v_club.id is null then
    return jsonb_build_object('success', false, 'error', 'That Club Could Not Be Found');
  end if;

  -- The target club and any concurrent union admission serialize on this row.
  -- Resolve access after the lock, before the first balance change.
  v_scope := public.fn_cashier_mint_scope(p_club_id);
  if v_scope is null then
    return jsonb_build_object('success', false, 'error', 'Mint Is Unavailable For This Account');
  end if;

  if v_scope = 'union' then
    v_deduct := deduct_diamonds(
      v_actor, v_diamonds::integer,
      'Chip Mint: ' || v_chips::text || ' chips minted to union bank',
      'chip_mint', 'chip_mint',
      jsonb_build_object('club_id', p_club_id, 'union_id', p_club_id,
                         'chips', v_chips, 'op_id', v_op_id, 'diamonds_per_chip', v_rate),
      null, 0);
    if coalesce((v_deduct->>'success')::boolean, false) = false then
      return jsonb_build_object('success', false,
        'error', coalesce(v_deduct->>'error', 'That Diamond Deduction Did Not Go Through'));
    end if;
    select coalesce(diamonds, 0) into v_diamonds_after from profiles where id = v_actor;

    /* THE MINT (chip standard 3.1, 2026-09-04): chips bought with diamonds
       are ISSUED. Declared issuance_reserve -> union_bank with the op id as
       the journal key; the register row follows from the leg (deferred
       trigger on chip_ledger). Undeclared, this landed in suspense and the
       register never saw it. */
    perform public.fn_ca_declare_ledger('mint', 'issuance_reserve', null, null,
                                        'diamond-mint:' || v_op_id::text, null);
    insert into union_wallets (union_id, chip_balance)
    values (p_club_id, v_chips)
    on conflict (union_id)
    do update set chip_balance = coalesce(union_wallets.chip_balance, 0) + v_chips,
                  updated_at = now();
    perform set_config('app.ledger_category', '', true);
    perform set_config('app.ledger_counterparty', '', true);
    perform set_config('app.ledger_idempotency_key', '', true);
    select chip_balance into v_union_bank_after
      from union_wallets where union_id = p_club_id;

    insert into chip_transactions (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
    values (p_club_id, v_actor, null, v_chips, 'mint',
            'Union Chip Mint: ' || v_chips::text || ' chips from ' || v_diamonds::text || ' diamonds at ' || v_rate::text || ' per chip',
            jsonb_build_object('op_id', v_op_id, 'scope', 'union',
                               'diamonds_spent', v_diamonds, 'union_id', p_club_id,
                               'diamonds_per_chip', v_rate),
            v_union_bank_after);

    return jsonb_build_object('success', true, 'replayed', false, 'scope', 'union',
      'chips', v_chips, 'diamonds_spent', v_diamonds, 'diamonds_per_chip', v_rate,
      'diamonds_after', v_diamonds_after, 'union_bank_after', v_union_bank_after);
  else
    v_deduct := deduct_diamonds(
      v_actor, v_diamonds::integer,
      'Chip Mint: ' || v_chips::text || ' chips minted to club bank',
      'chip_mint', 'chip_mint',
      jsonb_build_object('club_id', p_club_id, 'chips', v_chips, 'op_id', v_op_id,
                         'diamonds_per_chip', v_rate),
      null, 0);
    if coalesce((v_deduct->>'success')::boolean, false) = false then
      return jsonb_build_object('success', false,
        'error', coalesce(v_deduct->>'error', 'That Diamond Deduction Did Not Go Through'));
    end if;
    select coalesce(diamonds, 0) into v_diamonds_after from profiles where id = v_actor;

    /* THE MINT (chip standard 3.1, 2026-09-04): see the union branch. */
    perform public.fn_ca_declare_ledger('mint', 'issuance_reserve', null, null,
                                        'diamond-mint:' || v_op_id::text, null);
    update clubs set chip_treasury = coalesce(chip_treasury, 0) + v_chips, updated_at = now()
     where id = p_club_id
     returning chip_treasury into v_pool_after;
    perform set_config('app.ledger_category', '', true);
    perform set_config('app.ledger_counterparty', '', true);
    perform set_config('app.ledger_idempotency_key', '', true);

    insert into chip_transactions (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
    values (p_club_id, v_actor, null, v_chips, 'mint',
            'Chip Mint: ' || v_chips::text || ' chips from ' || v_diamonds::text || ' diamonds at ' || v_rate::text || ' per chip',
            jsonb_build_object('op_id', v_op_id, 'scope', 'club',
                               'diamonds_spent', v_diamonds, 'diamonds_per_chip', v_rate),
            v_pool_after);

    return jsonb_build_object('success', true, 'replayed', false, 'scope', 'club',
      'chips', v_chips, 'diamonds_spent', v_diamonds, 'diamonds_per_chip', v_rate,
      'diamonds_after', v_diamonds_after, 'club_pool_after', v_pool_after);
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_enforce_club_enters_union_empty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  b jsonb;
BEGIN
  IF NEW.club_id = NEW.union_id THEN
    RETURN NEW;
  END IF;

  -- Match the mint's row lock before checking the balances the union receives.
  PERFORM 1 FROM public.clubs WHERE id = NEW.club_id FOR UPDATE;
  b := public.fn_club_union_join_blockers(NEW.club_id);

  IF (b->>'is_empty')::boolean THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'check_violation',
    MESSAGE = 'This club still holds chips and cannot join a union yet.',
    DETAIL  = format(
      'treasury %s, club promo %s, member wallets %s across %s members, horse bankrolls %s across %s horses, agent wallets %s across %s agents, %s on the felt in %s open seats, BBJ pool %s. Total %s.',
      b->>'club_treasury', b->>'club_promo',
      b->>'member_wallets', b->>'member_count',
      b->>'horse_wallets', b->>'horse_count',
      b->>'agent_wallets', b->>'agent_count',
      b->>'chips_on_felt', b->>'open_seats',
      b->>'bbj_pool', b->>'total'),
    HINT    = 'Cash your players and agents down to zero, close the tables and empty the treasury first. Once the club is in the union, the union funds it.';
END;
$function$;

-- Probe both public functions without selecting a real financial account.
-- The native regression exercises accepted club and union deposits, journals,
-- exact retries and concurrent admission against a disposable PostgreSQL database.
-- @probe-for: public.fn_mint_chips_from_diamonds
DO $probe$
DECLARE
  target uuid := gen_random_uuid();
  answer jsonb;
BEGIN
  IF public.fn_cashier_mint_scope(target) IS NOT NULL THEN
    RAISE EXCEPTION 'an unknown target acquired mint permission';
  END IF;
  answer := public.fn_mint_chips_from_diamonds(target, 0, gen_random_uuid());
  IF (answer->>'success')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'an empty mint was not refused';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
