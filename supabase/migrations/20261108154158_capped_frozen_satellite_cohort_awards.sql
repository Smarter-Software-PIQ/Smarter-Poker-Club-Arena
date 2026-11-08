-- @live-proof: md5(pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure)) = '07247c1fbbdb9709740d00bcc370eb75'
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)) = '88743d6d6484247ac4175c6d8bd9e0c9'
-- @live-proof: md5(pg_get_functiondef('public.fn_execute_capped_satellite_terminal_request(uuid,uuid)'::regprocedure)) = 'd2a2e8807f7b4319b5cacf0414bc9bed'
-- Field-capped frozen satellite awards retain every original entitlement.
BEGIN;
DO $patch$
DECLARE source text := pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure);
BEGIN
 IF md5(source)<>'0b914a047324b07b4fd8387a44cc36c6' THEN RAISE EXCEPTION 'Capped satellite source predecessor drift'; END IF;
 source:=replace(source,$old0$  v_ticket_award_count:=floor(v_pool/v_ticket_cost)::integer;$old0$,$new0$  v_ticket_award_count:=least(v_field_size,floor(v_pool/v_ticket_cost)::integer);
  IF v_ticket_award_count=v_field_size
     AND v_pool>v_ticket_award_count*v_ticket_cost
     AND current_setting('app.satellite_capped_awards',true) IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'capped satellite awards require a compatible terminal owner' USING ERRCODE='55000';
  END IF;$new0$);
 source:=replace(source,$old1$AND e.ticket_value=v_ticket_cost AND e.remainder_value=0)<>v_ticket_award_count$old1$,$new1$AND e.ticket_value=v_ticket_cost)<>v_ticket_award_count
     OR (SELECT sum(e.ticket_value+e.remainder_value) FROM public.tournament_satellite_entitlements e
          WHERE e.tournament_id=p_tournament_id) IS DISTINCT FROM v_pool
     OR EXISTS(SELECT 1 FROM public.tournament_satellite_entitlements e
          WHERE e.tournament_id=p_tournament_id AND e.remainder_value>0
            AND (e.position<>least(v_ticket_award_count+1,v_field_size)
              OR e.remainder_value<>v_pool-v_ticket_award_count*v_ticket_cost))$new1$);
 source:=replace(source,$old2$  v_ticket_award_count := floor(v_pool / v_ticket_cost)::integer;$old2$,$new2$  v_ticket_award_count := least(v_field_size,floor(v_pool / v_ticket_cost)::integer);$new2$);
 source:=replace(source,$old3$IF v_remainder < 0 OR v_remainder >= v_ticket_cost THEN$old3$,$new3$IF v_remainder < 0 OR (v_remainder >= v_ticket_cost AND v_ticket_award_count<>v_field_size) THEN$new3$);
 source:=replace(source,$old4$IF (v_ticket_award_count
      + CASE WHEN v_remainder > 0 THEN 1 ELSE 0 END) > v_field_size THEN$old4$,$new4$IF v_ticket_award_count > v_field_size THEN$new4$);
 source:=replace(source,$old5$v_bubble_position := v_ticket_award_count + 1;$old5$,$new5$v_bubble_position := least(v_ticket_award_count + 1,v_field_size);$new5$);
 source:=replace(source,$old6$AND tp.position = v_bubble_position;$old6$,$new6$AND (CASE WHEN v_ticket_award_count=v_field_size
             THEN tp.user_id=v_award_users[v_bubble_position]
             ELSE tp.position=v_bubble_position END);$new6$);
 source:=replace(source,$old7$UPDATE public.tournament_players SET prize = v_remainder
     WHERE tournament_id = p_tournament_id
       AND user_id = v_bubble_user_id AND position = v_bubble_position;$old7$,$new7$UPDATE public.tournament_players SET prize = prize + v_remainder
     WHERE tournament_id = p_tournament_id
       AND user_id = v_bubble_user_id
       AND (v_ticket_award_count=v_field_size OR position = v_bubble_position);$new7$);
 EXECUTE source;
END $patch$;
DO $patch$
DECLARE source text := pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure);
BEGIN
 IF md5(source)<>'19eac81a82ffb4f9d2965bbbf881f9ca' THEN RAISE EXCEPTION 'Capped satellite source predecessor drift'; END IF;
 source:=replace(source,'floor(v_h.pool / v_h.ticket_cost)::integer','least(v_h.field_size,floor(v_h.pool / v_h.ticket_cost)::integer)');
 source:=replace(source,$old0$AND bubble.position = v_h.bubble_position$old0$,$new0$AND (bubble.position = v_h.bubble_position OR
           (v_h.ticket_award_count=v_h.field_size AND v_h.bubble_position=v_h.field_size
             AND EXISTS(SELECT 1 FROM public.tournament_satellite_awards a
               WHERE a.tournament_id=p_tournament_id AND a.place=v_h.bubble_position
                 AND a.user_id=bubble.user_id)))$new0$);
 source:=replace(source,$old1$AND tp.prize IS DISTINCT FROM CASE
         WHEN EXISTS(SELECT 1 FROM public.tournament_satellite_awards a WHERE a.tournament_id=p_tournament_id AND a.user_id=tp.user_id) THEN v_h.ticket_cost
         WHEN v_h.remainder > 0 AND tp.position = v_h.bubble_position
           THEN v_h.remainder
         ELSE 0::numeric
       END$old1$,$new1$AND tp.prize IS DISTINCT FROM
         (CASE WHEN EXISTS(SELECT 1 FROM public.tournament_satellite_awards a WHERE a.tournament_id=p_tournament_id AND a.user_id=tp.user_id)
           THEN v_h.ticket_cost ELSE 0::numeric END)
         + (CASE WHEN v_h.remainder > 0 AND tp.user_id=v_h.bubble_user_id
           THEN v_h.remainder ELSE 0::numeric END)$new1$);
 EXECUTE source;
END $patch$;
ALTER TABLE public.tournament_satellite_settlements
  DROP CONSTRAINT tournament_satellite_settlements_check6,
  DROP CONSTRAINT tournament_satellite_settlements_check14,
  ADD CONSTRAINT tournament_satellite_settlements_check6
    CHECK (remainder<ticket_cost OR (receipt_version=3 AND ticket_award_count=field_size)),
  ADD CONSTRAINT tournament_satellite_settlements_check14 CHECK (
    ((remainder=0 AND bubble_user_id IS NULL AND bubble_position IS NULL)
    OR (remainder>0 AND bubble_user_id IS NOT NULL AND bubble_position<=field_size
      AND (bubble_position=ticket_award_count+1 OR
        (receipt_version=3 AND ticket_award_count=field_size AND bubble_position=field_size)))) IS TRUE);

-- Only the successor engine invokes this entry point. The incumbent executor
-- keeps the field-capped refusal until a compatible receipt consumer is serving.
CREATE FUNCTION public.fn_execute_capped_satellite_terminal_request(p_request_id uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $function$
DECLARE result jsonb; prior text:=current_setting('app.satellite_capped_awards',true);
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('app.satellite_capped_awards','v1',true);
  result:=public.fn_execute_tournament_terminal_request(p_request_id,p_generation);
  PERFORM set_config('app.satellite_capped_awards',coalesce(prior,''),true);
  RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid) TO service_role;
COMMIT;
