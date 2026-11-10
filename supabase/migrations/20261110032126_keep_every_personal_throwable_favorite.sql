-- Keep every personally thrown item; use popular defaults to fill the first ten slots.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_player_throwable_favorites()
RETURNS TABLE (throwable_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH catalog(id) AS (
    VALUES
      ('crown'::text),
      ('chip_rain'::text),
      ('diamond_shower'::text),
      ('velvet_rope'::text),
      ('champagne_tower'::text),
      ('standing_ovation'::text),
      ('whale'::text),
      ('to_the_moon'::text),
      ('missile'::text),
      ('donkey'::text),
      ('tilt_meter'::text),
      ('bad_beat_bandage'::text),
      ('bubble_boy'::text),
      ('slot_machine'::text),
      ('pumpkin'::text),
      ('snowball'::text),
      ('party_popper'::text),
      ('heart_arrow'::text),
      ('rat_card'::text),
      ('party_face'::text),
      ('thinking'::text),
      ('loser_hand'::text),
      ('blush'::text),
      ('ok_smug'::text),
      ('sleeping'::text),
      ('facepalm'::text),
      ('screaming'::text),
      ('vomit_rainbow'::text),
      ('surrender'::text),
      ('energy_ball'::text),
      ('sloth'::text),
      ('fish'::text),
      ('thumbs_up'::text),
      ('thumbs_down'::text),
      ('laughing_emoji'::text),
      ('crying_emoji'::text),
      ('angry_emoji'::text),
      ('cool_sunglasses_emoji'::text),
      ('heart'::text),
      ('star'::text),
      ('tomato'::text),
      ('cracked_egg'::text),
      ('banana_peel'::text),
      ('pizza_slice'::text),
      ('cake'::text),
      ('poop'::text),
      ('water_gun'::text),
      ('boxing_glove'::text),
      ('anvil'::text),
      ('trash_can'::text),
      ('snowman'::text),
      ('magnet'::text),
      ('basketball'::text),
      ('football'::text),
      ('tennis_ball'::text),
      ('bowling_ball'::text),
      ('horseshoe'::text),
      ('dice'::text),
      ('magic_8_ball'::text),
      ('beer'::text),
      ('champagne'::text),
      ('coffee'::text),
      ('cash_stack'::text),
      ('diamond'::text),
      ('rose'::text),
      ('trophy'::text),
      ('fireworks'::text),
      ('bomb'::text),
      ('ufo'::text),
      ('alien'::text),
      ('robot'::text),
      ('ghost'::text),
      ('skull'::text),
      ('lightning_bolt'::text),
      ('doge'::text),
      ('shark'::text),
      ('bear'::text),
      ('chicken'::text),
      ('rubber_duck'::text)
  ), usage AS (
    SELECT CASE WHEN tu.throwable_id = 'rocket' THEN 'missile' ELSE tu.throwable_id END AS id,
      max(tu.created_at) FILTER (WHERE tu.user_id = v_user) AS last_used,
      count(*) AS global_count,
      count(*) FILTER (WHERE tu.user_id = v_user) AS personal_count
    FROM public.throw_usage tu
    GROUP BY 1
  ), ranked AS (
  SELECT c.id, u.personal_count, row_number() OVER (ORDER BY u.last_used DESC NULLS LAST,
    coalesce(u.personal_count, 0) DESC, coalesce(u.global_count, 0) DESC, c.id) AS position
  FROM catalog c LEFT JOIN usage u ON u.id = c.id
  )
  SELECT r.id FROM ranked r
  WHERE r.personal_count > 0 OR r.position <= 10
  ORDER BY r.position;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_player_throwable_favorites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_player_throwable_favorites() TO authenticated;
COMMIT;
