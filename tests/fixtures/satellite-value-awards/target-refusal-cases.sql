-- Corrupt only the isolated opening inside each subtransaction. The exception
-- must carry the original SQLSTATE and describe the value the guard rejected.
DO $refusals$
DECLARE
  c jsonb;
  source_id uuid;
  target_id uuid;
  qualifiers uuid[];
  single_award boolean;
  diamond boolean;
  expected text;
BEGIN
  FOREACH single_award IN ARRAY ARRAY[false,true] LOOP
    FOREACH diamond IN ARRAY ARRAY[false,true] LOOP
      c := CASE
        WHEN single_award AND diamond THEN pg_temp.single_diamond_case('refusal_single_diamond',1,false)
        WHEN single_award THEN pg_temp.single_value_case('refusal_single',1,false)
        WHEN diamond THEN pg_temp.qualifier_diamond_case('refusal_cohort_diamond',2,false)
        ELSE pg_temp.qualifier_case('refusal_cohort',2,false)
      END;
      source_id := (c->>'tournament_id')::uuid;
      target_id := (c->>'target_id')::uuid;
      SELECT array_agg(value::uuid) INTO qualifiers FROM jsonb_array_elements_text(c->'qualifier_ids');
      FOREACH expected IN ARRAY ARRAY['players_mismatch',CASE WHEN diamond THEN 'prize_pool_mismatch' ELSE 'prize_balance_mismatch' END] LOOP
        BEGIN
          IF expected='players_mismatch' THEN
            UPDATE public.tournaments SET current_players=current_players+1 WHERE id=target_id;
          ELSE
            UPDATE public.tournaments SET prize_pool=prize_pool+1 WHERE id=target_id;
          END IF;
          IF single_award THEN
            PERFORM public.fn_settle_satellite_tournament(source_id,qualifiers[1]);
          ELSE
            PERFORM public.fn_settle_satellite_qualifiers(source_id,qualifiers);
          END IF;
          RAISE EXCEPTION 'malformed target accepted';
        EXCEPTION WHEN SQLSTATE 'P0404' THEN
          PERFORM pg_temp.qualifier_assert(right(SQLERRM,length(expected)+12)='[invariant='||expected||']',
            'target refusal lacks expected invariant '||expected||': '||SQLERRM);
        END;
        PERFORM pg_temp.qualifier_assert(NOT EXISTS (
          SELECT FROM public.tournament_satellite_settlements WHERE tournament_id=source_id
        ),'refusal published a settlement receipt');
      END LOOP;
    END LOOP;
  END LOOP;
END $refusals$;
