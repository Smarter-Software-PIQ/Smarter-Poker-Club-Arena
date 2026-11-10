-- Paid Diamond Spins: exactly 25% combined ordinary/Super game probability.
-- No cooldown, pity counter, wager limit or payout change. Historical receipts
-- and welcome/daily draws keep their original contract. New paid receipts v5.
-- @live-proof: to_regprocedure('public.fn_wheel_spin_v5(uuid,uuid,text,bigint,text,uuid)') IS NOT NULL AND (SELECT contract_version=5 FROM public.diamond_wheel_release WHERE singleton)
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

-- Earlier wallet widening removed this door dynamically. Keep its retirement
-- explicit so no integer overload can shadow the single bigint RPC.
DROP FUNCTION IF EXISTS public.fn_wheel_spin_v2(uuid,uuid,text,integer,text,uuid);

CREATE FUNCTION public.fn_wheel_v5_weights(p_prev_ord smallint, p_prev_super_game text DEFAULT NULL)
RETURNS integer[] LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE
 w integer[]:=array_fill(0,ARRAY[12]);
 base integer[]:=ARRAY[0,29600,6667,0,1200,6666,0,240,6667,0,160,0];
 games integer[]; game_budget integer; other_budget integer; total integer; remaining integer;
 hit integer; i integer; r record;
BEGIN
 IF p_prev_ord IS NOT NULL AND p_prev_ord NOT BETWEEN 1 AND 12 THEN
  RAISE EXCEPTION 'The Previous Wheel Outcome Is Invalid'; END IF;
 IF p_prev_super_game IS NOT NULL THEN
  hit:=CASE p_prev_super_game WHEN 'plinko' THEN 1 WHEN 'crash' THEN 4 WHEN 'crossing' THEN 7 WHEN 'mines' THEN 10 END;
  IF hit IS NULL THEN RAISE EXCEPTION 'The Previous Super Game Is Invalid'; END IF;
 END IF;
 w[12]:=CASE WHEN p_prev_ord=12 THEN 0 ELSE 1000 END;
 -- Upgrade remains 80% game and 20% instant chip prizes.
 game_budget:=25000-w[12]*4/5;
 SELECT array_agg(ord ORDER BY ord) INTO games FROM unnest(ARRAY[1,4,7,10]) ord
 WHERE ord IS DISTINCT FROM p_prev_ord AND ord IS DISTINCT FROM hit;
 FOR i IN 1..array_length(games,1) LOOP
  w[games[i]]:=game_budget/array_length(games,1)+CASE WHEN i<=game_budget%array_length(games,1) THEN 1 ELSE 0 END;
 END LOOP;
 IF p_prev_ord IS NOT NULL THEN base[p_prev_ord]:=0; END IF;
 SELECT sum(x)::integer INTO total FROM unnest(base) x;
 other_budget:=100000-game_budget-w[12];
 FOR i IN 1..12 LOOP
  IF base[i]>0 THEN w[i]:=(base[i]::bigint*other_budget/total)::integer; END IF;
 END LOOP;
 SELECT 100000-sum(x)::integer INTO remaining FROM unnest(w) x;
 FOR r IN SELECT ord FROM generate_series(1,12) ord WHERE base[ord]>0
  ORDER BY (base[ord]::bigint*other_budget)%total DESC,ord LOOP
  EXIT WHEN remaining=0;
  w[r.ord]:=w[r.ord]+1; remaining:=remaining-1;
 END LOOP;
 RETURN w;
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_v5_weights(smallint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_v5_weights(smallint,text) TO authenticated,service_role;

CREATE FUNCTION public.fn_wheel_v5_segments(p_entry bigint,p_rate integer,p_secondary boolean DEFAULT false,p_vip boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE WHEN p_secondary THEN public.fn_wheel_v4_segments(p_entry,p_rate,true,p_vip)
 ELSE (SELECT jsonb_agg(value||jsonb_build_object('weight',w[(value->>'ord')::integer],
   'probability',w[(value->>'ord')::integer]/100000::numeric) ORDER BY (value->>'ord')::integer)
 FROM jsonb_array_elements(public.fn_wheel_v4_segments(p_entry,p_rate,false,p_vip)),
 LATERAL (SELECT public.fn_wheel_v5_weights(NULL,NULL) w) weights) END
$$;
REVOKE ALL ON FUNCTION public.fn_wheel_v5_segments(bigint,integer,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_v5_segments(bigint,integer,boolean,boolean) TO authenticated,service_role;

-- Change only draw weights/version tags in the original transaction owner.
-- Keep commit/player locks, replay matching, debit, every payout, guarantees,
-- owner liability and durable unpaid-prize claims byte-for-byte.
DO $patch$
DECLARE body text; item record;
BEGIN
 SELECT pg_get_functiondef('public.fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)'::regprocedure) INTO body;
 FOR item IN SELECT * FROM (VALUES
 ($old$  p_welcome boolean:=p_mode='welcome';$old$,
  $new$  p_welcome boolean:=p_mode='welcome';
  v_contract integer:=CASE WHEN p_mode='paid' THEN 5 ELSE 4 END;
  v_domain text:=CASE WHEN p_mode='paid' THEN 'wheel-v5' ELSE 'wheel-v4' END;$new$),
 ($old$v_segments:=public.fn_wheel_v4_segments(v_price,v_rate,false,v_vip);$old$,
  $new$v_segments:=CASE WHEN p_mode='paid' THEN public.fn_wheel_v5_segments(v_price,v_rate,false,v_vip) ELSE public.fn_wheel_v4_segments(v_price,v_rate,false,v_vip) END;$new$),
 ($old$v_weights:=public.fn_wheel_v4_weights(v_prev_ord,v_prev_super_game);$old$,
  $new$v_weights:=CASE WHEN p_mode='paid' THEN public.fn_wheel_v5_weights(v_prev_ord,v_prev_super_game) ELSE public.fn_wheel_v4_weights(v_prev_ord,v_prev_super_game) END;$new$),
 ($old$<>COALESCE((SELECT weight FROM public.fn_wheel_v4_model() WHERE ord=v_prev_ord),100000)$old$,
  $new$<>(CASE WHEN p_mode='paid' THEN 100000 ELSE COALESCE((SELECT weight FROM public.fn_wheel_v4_model() WHERE ord=v_prev_ord),100000) END)$new$),
 ($old$convert_to('wheel-v4:'||v_client||':'||v_nonce,'UTF8')$old$,
  $new$convert_to(v_domain||':'||v_client||':'||v_nonce,'UTF8')$new$),
 ($old$convert_to('wheel-v4-upgrade:'||v_client||':'||v_nonce,'UTF8')$old$,
  $new$convert_to(v_domain||'-upgrade:'||v_client||':'||v_nonce,'UTF8')$new$),
 ($old$'domain','wheel-v4-upgrade'$old$,$new$'domain',v_domain||'-upgrade'$new$),
 ($old$'domain','wheel-v4'$old$,$new$'domain',v_domain$new$),
 ($old$'model','wheel-v4'$old$,$new$'model',v_domain$new$),
 ($old$'segment_version',4$old$,$new$'segment_version',v_contract$new$),
 ($old$(v_spin_id, v_host, v_kind, p_club_id, v_user, 4,$old$,
  $new$(v_spin_id, v_host, v_kind, p_club_id, v_user, v_contract,$new$)
 ) edits(old,new) LOOP
  IF (length(body)-length(replace(body,item.old,'')))/length(item.old)<>1 THEN
   RAISE EXCEPTION 'Wheel v5 source preimage differs: %',item.old; END IF;
  body:=replace(body,item.old,item.new);
 END LOOP;
 IF strpos(body,$old$'contract_version',4$old$)=0 THEN RAISE EXCEPTION 'Wheel contract version preimage differs'; END IF;
 body:=replace(body,$old$'contract_version',4$old$,$new$'contract_version',v_contract$new$);
 body:=replace(body,'FUNCTION public.fn_wheel_spin_v2(', 'FUNCTION public.fn_wheel_spin_v5_core(');
 EXECUTE body;

 SELECT pg_get_functiondef('public.fn_wheel_state_v2(uuid,bigint)'::regprocedure) INTO body;
 IF strpos(body,$old$'model_version','wheel-v4'$old$)=0 OR strpos(body,'public.fn_wheel_v4_segments(')=0 THEN
  RAISE EXCEPTION 'Wheel v5 quote preimage differs'; END IF;
 body:=replace(replace(replace(body,$old$'contract_version',4$old$,$new$'contract_version',5$new$),
   $old$'model_version','wheel-v4'$old$,$new$'model_version','wheel-v5'$new$),
   'public.fn_wheel_v4_segments(','public.fn_wheel_v5_segments(');
 EXECUTE body;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_wheel_spin_v5_core(uuid,uuid,text,bigint,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_wheel_spin_v5(p_club_id uuid,p_commit_id uuid,p_client_seed text,p_entry_diamonds bigint,
 p_mode text DEFAULT 'paid',p_bonus_ticket_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT public.fn_wheel_spin_v5_core(p_club_id,p_commit_id,p_client_seed,p_entry_diamonds,p_mode,p_bonus_ticket_id)
$$;
REVOKE ALL ON FUNCTION public.fn_wheel_spin_v5(uuid,uuid,text,bigint,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_spin_v5(uuid,uuid,text,bigint,text,uuid) TO authenticated,service_role;

-- A previously open v4 client cannot parse a v5 receipt. Refuse only its NEW
-- paid request, before funds move. It can always retrieve an already paid spin.
CREATE OR REPLACE FUNCTION public.fn_wheel_spin_v2(p_club_id uuid,p_commit_id uuid,p_client_seed text,p_entry_diamonds bigint,
 p_mode text DEFAULT 'paid',p_bonus_ticket_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_mode='paid' AND NOT EXISTS(SELECT 1 FROM public.wheel_spins WHERE commit_id=p_commit_id) THEN
  RETURN jsonb_build_object('ok',false,'error','Refresh Diamond Spins To Load The Updated Wheel. No Diamonds Were Spent');
 END IF;
 RETURN public.fn_wheel_spin_v5_core(p_club_id,p_commit_id,p_client_seed,p_entry_diamonds,p_mode,p_bonus_ticket_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid) TO authenticated,service_role;

-- The engine supplies the same authenticated player call for a horse. Its
-- adapter must follow the new endpoint too; all identity gates stay unchanged.
DO $horse$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.fn_horse_diamond_spins(uuid,text,jsonb)'::regprocedure) INTO body;
 IF (length(body)-length(replace(body,'public.fn_wheel_spin_v2(','')))/length('public.fn_wheel_spin_v2(')<>1 THEN
  RAISE EXCEPTION 'Horse wheel adapter preimage differs'; END IF;
 EXECUTE replace(body,'public.fn_wheel_spin_v2(','public.fn_wheel_spin_v5(');
END $horse$;
ALTER TABLE public.diamond_wheel_release DROP CONSTRAINT diamond_wheel_release_contract_version_check,
 ADD CONSTRAINT diamond_wheel_release_contract_version_check CHECK (contract_version IN (4,5));
UPDATE public.diamond_wheel_release SET contract_version=5 WHERE singleton;
COMMIT;
