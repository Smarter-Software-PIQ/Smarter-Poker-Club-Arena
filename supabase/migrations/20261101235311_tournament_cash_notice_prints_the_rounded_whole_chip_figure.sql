-- 20261101235311_tournament_cash_notice_prints_the_rounded_whole_chip_figure.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-01, from Burls' screenshots):
--
-- "ITS SHOWING THAT HE WON 507.96 IN HIS NOTIFICATIONS BUT THE TOURNAMENT
--  SAID 508. MAKE SURE THE NUMBERS ALWAYS STAY THE SAME AND 'ROUND UP' IN
--  THE NOTIFICATON AS WELL."
--
-- The tournament's own surfaces print a chip prize as a WHOLE figure through
-- the client's one chips() rule - Math.round, grouped, never a decimal
-- (src/components/tournament/details/types.ts). The Rewards ladder Burls was
-- reading said 508. The settlement notice this trigger writes forced two
-- decimals onto the same amount ('FM999,999,999,990.00' -> "507.96"), so the
-- two surfaces disagreed about one payment.
--
-- One figure, one rounding: the notice now prints round(amount) exactly as
-- the Diamond branch always did and exactly as the client's chips() does -
-- 507.96 -> 508, 520.20 -> 520 - so the notice can never disagree with the
-- ladder again. The wallet ledger keeps the exact credit (507.96); a display
-- rounds, the books do not.
--
-- Everything else in the function is byte-identical to production's current
-- definition, read back from pg_get_functiondef before this change.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_ca_notify_tournament_cash()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t record;
  v_target text;
  v_diamond boolean;
  v_unit text;
  v_amount_text text;
  v_title text;
  v_message text;
BEGIN
  -- Exactly once: the moment the obligation becomes fully paid.
  IF NEW.settled_at IS NULL OR NEW.user_id IS NULL
     OR COALESCE(NEW.amount_paid,0) <= 0
     OR NEW.kind NOT IN ('place','bubble_protection','satellite_remainder','seat') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.settled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  /* A notice can never cost a player their money: it runs in its own
     subtransaction and a failure is a warning, never a rollback of the
     payment that triggered it. */
  BEGIN
    IF EXISTS (SELECT 1 FROM public.notifications n
                WHERE n.user_id = NEW.user_id
                  AND n.type = 'tournament_cash'
                  AND n.data->>'obligation_id' = NEW.id::text) THEN
      RETURN NULL;
    END IF;

    SELECT t.id, t.name, t.satellite_target_id INTO v_t
      FROM public.tournaments t WHERE t.id = NEW.tournament_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    v_diamond := public.fn_poker_diamond_tournament(NEW.tournament_id);
    v_unit := CASE WHEN v_diamond THEN 'Diamonds' ELSE 'Chips' END;
    /* THE NOTICE PRINTS THE LADDER'S FIGURE (Dan 2026-11-01). Whole, rounded
       to the nearest chip or Diamond, exactly as every tournament surface
       prints a prize - never a decimal, never a second number for one
       payment. The wallet ledger keeps the exact amount. */
    v_amount_text := to_char(round(NEW.amount_paid), 'FM999,999,999,990');

    IF NEW.kind = 'seat' THEN
      SELECT x.name INTO v_target FROM public.tournaments x WHERE x.id = v_t.satellite_target_id;
      v_title := 'You Won A Seat';
      v_message := format('You Won A Seat To %s From %s.',
        COALESCE(v_target, 'The Target Event'), COALESCE(v_t.name, 'Your Satellite'));
    ELSIF NEW.kind = 'bubble_protection' THEN
      v_title := 'Bubble Protection Paid';
      v_message := format('Your Buy-In Of %s %s From %s Is Back In Your Wallet.',
        v_amount_text, v_unit, COALESCE(v_t.name, 'Your Tournament'));
    ELSIF NEW.kind = 'satellite_remainder' THEN
      v_title := 'Satellite Cash Paid';
      v_message := format('You Won %s %s In %s. It Is Already In Your Wallet.',
        v_amount_text, v_unit, COALESCE(v_t.name, 'Your Satellite'));
    ELSIF NEW.place = 1 THEN
      v_title := 'You Won The Tournament';
      v_message := format('You Won %s %s For First Place In %s. It Is Already In Your Wallet.',
        v_amount_text, v_unit, COALESCE(v_t.name, 'Your Tournament'));
    ELSE
      v_title := format('You Finished %s', public.fn_ca_ordinal(NEW.place));
      v_message := format('You Won %s %s For %s Place In %s. It Is Already In Your Wallet.',
        v_amount_text, v_unit, public.fn_ca_ordinal(NEW.place), COALESCE(v_t.name, 'Your Tournament'));
    END IF;

    INSERT INTO public.notifications(user_id, type, title, message, data, link)
    VALUES (NEW.user_id, 'tournament_cash', v_title, v_message,
      jsonb_build_object(
        'obligation_id', NEW.id,
        'tournament_id', NEW.tournament_id,
        'kind', NEW.kind,
        'place', NEW.place,
        'amount', NEW.amount_paid,
        'asset', CASE WHEN v_diamond THEN 'diamonds' ELSE 'chips' END),
      '/hub/club-arena/tournaments/' || NEW.tournament_id::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tournament cash notice for obligation % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

COMMIT;
