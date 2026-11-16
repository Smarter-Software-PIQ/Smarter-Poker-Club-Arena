CREATE OR REPLACE FUNCTION public.fn_ca_horse_roster_seat_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.left_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.left_at IS NULL
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.table_id IS NOT DISTINCT FROM NEW.table_id THEN RETURN NEW; END IF;
  -- Existing seats and settlement updates remain legal. Tournaments are unchanged.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=NEW.user_id AND p.is_horse)
     OR EXISTS (SELECT 1 FROM public.tables t WHERE t.id=NEW.table_id AND t.tournament_id IS NOT NULL)
  THEN RETURN NEW; END IF;

  -- Restrictions precede roster exemptions. An already-owned same-game move finishes,
  -- then the normal rotator exits; existing stack updates and exits remain legal.
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.id=NEW.table_id
    AND NOT public.fn_horse_cash_game_allowed(t.game_variant,t.small_blind,t.big_blind,t.tournament_id))
    AND NOT (NEW.active_game_scope IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.table_seats s WHERE s.user_id=NEW.user_id AND s.left_at IS NULL
      AND s.active_game_scope=NEW.active_game_scope AND s.table_id IS DISTINCT FROM NEW.table_id))
  THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='horse_cash_game_restricted: owner cash game and PLO stake policy';
  END IF;
  -- Diamond cash is a distinct asset, never inferred from a caller's club id.
  -- A malformed platform/union identity cannot widen the Club Arena roster.
  IF EXISTS (
    SELECT 1 FROM public.tables t
    JOIN public.clubs c ON c.id=t.club_id
    JOIN public.profiles p ON p.id=NEW.user_id
    JOIN public.ca_horse_fleet_register r ON r.horse_id=p.id AND r.retired_at IS NULL
    WHERE t.id=NEW.table_id AND t.tournament_id IS NULL AND t.union_id IS NULL
      AND c.asset='diamonds' AND c.is_platform IS TRUE AND c.union_id IS NULL
      AND p.is_horse AND coalesce(p.status,'active')='active'
      AND coalesce(p.horse_status,'available') <> 'disabled'
  ) THEN RETURN NEW; END IF;
  -- A game's already-owned seat move must complete before the normal safe exit.
  IF NEW.active_game_scope IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.table_seats s WHERE s.user_id=NEW.user_id AND s.left_at IS NULL
      AND s.active_game_scope=NEW.active_game_scope AND s.table_id IS DISTINCT FROM NEW.table_id)
  THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_horse_active_roster r WHERE r.horse_id=NEW.user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='horse_not_on_cash_roster: only the selected cash performance roster plays Club Arena cash games';
  END IF;

  IF EXISTS(SELECT 1 FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
    WHERE t.id=NEW.table_id AND g.id='c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid
      AND g.enabled AND g.lightning_enabled AND g.variant='plo4' AND g.sb=1 AND g.bb=2)
  THEN
    PERFORM public.fn_plo_lightning_horse_admit(NEW.table_id,NEW.user_id,clock_timestamp());
  ELSIF EXISTS(SELECT 1 FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
    WHERE t.id=NEW.table_id AND g.enabled AND g.lightning_enabled)
  THEN
    -- Every other Lightning game: one Horse at a time (20261111214248).
    PERFORM public.fn_lightning_horse_admit_paced(NEW.table_id,NEW.user_id,clock_timestamp());
  END IF;
  RETURN NEW;
END
$function$
