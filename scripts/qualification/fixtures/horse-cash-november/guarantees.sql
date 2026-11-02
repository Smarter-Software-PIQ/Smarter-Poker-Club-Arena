CREATE TABLE public.tournaments (
 id uuid PRIMARY KEY, name text, description text, short_description text,
 guaranteed_prize numeric, buy_in_amount numeric DEFAULT 0, buy_in_fee numeric DEFAULT 0,
 start_time timestamptz DEFAULT '2026-11-02 06:00+00', status text DEFAULT 'REGISTERING',
 prize_pool_finalized boolean DEFAULT false, entry_contract_locked boolean DEFAULT false,
 variant text DEFAULT 'nlh', tournament_type text DEFAULT 'MTT', satellite_target_id uuid,
 bubble_protection boolean DEFAULT false
);
CREATE TABLE public.tournament_players(tournament_id uuid);
CREATE OR REPLACE FUNCTION public.trg_freeze_registered_tournament_settlement_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF ROW(NEW.variant, NEW.tournament_type, NEW.satellite_target_id,
         NEW.bubble_protection, round(COALESCE(NEW.buy_in_amount, 0), 2),
         round(COALESCE(NEW.guaranteed_prize, 0), 2))
     IS NOT DISTINCT FROM
     ROW(OLD.variant, OLD.tournament_type, OLD.satellite_target_id,
         OLD.bubble_protection, round(COALESCE(OLD.buy_in_amount, 0), 2),
         round(COALESCE(OLD.guaranteed_prize, 0), 2)) THEN
    RETURN NEW;
  END IF;
  IF upper(COALESCE(OLD.status, '')) IN ('COMPLETING', 'COMPLETED')
     OR upper(COALESCE(NEW.status, '')) IN ('COMPLETING', 'COMPLETED') THEN
    RAISE EXCEPTION
      'tournament % settlement class, guarantee, Bubble Protection and buy-in are frozen once settlement begins',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'tournament % settlement class, guarantee, Bubble Protection and buy-in are frozen after its first entrant',
      OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER freeze_registered BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.trg_freeze_registered_tournament_settlement_contract();
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('0251fba4-dcc2-41f0-aec2-9cd567785c3d','500 GTD','500 Guarantee','500 Chip Guarantee',500.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('0418daad-05a5-4aa7-9728-5bf1a3ac12cc','500 GTD','500 Guarantee','500 Chip Guarantee',500.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('04746fce-4bad-4547-96ac-7e87b398648c','500 GTD','500 Guarantee','500 Chip Guarantee',5000.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('047da62c-3337-48f7-a3d2-22f0a802f14e','500 GTD','500 Guarantee','500 Chip Guarantee',2000.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('04ba4cca-c6a1-45a3-bd3c-5150b43e963b','500 GTD','500 Guarantee','500 Chip Guarantee',500.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('069ccf16-2b6f-4eb1-b980-a875860c4b44','500 GTD','500 Guarantee','500 Chip Guarantee',5000.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('0778af66-7924-44dd-b537-56af19adf1ad','500 GTD','500 Guarantee','500 Chip Guarantee',2000.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('077ae84a-0f9f-4bde-b02d-a071a2651176','500 GTD','500 Guarantee','500 Chip Guarantee',500.00);
INSERT INTO tournaments(id,name,description,short_description,guaranteed_prize) VALUES('0ae8dd91-4ed7-407d-a4ce-7a5f81116435','500 GTD','500 Guarantee','500 Chip Guarantee',2000.00);
INSERT INTO tournament_players VALUES('0418daad-05a5-4aa7-9728-5bf1a3ac12cc');
UPDATE tournaments SET status='RUNNING' WHERE id='04746fce-4bad-4547-96ac-7e87b398648c';
UPDATE tournaments SET prize_pool_finalized=true WHERE id='047da62c-3337-48f7-a3d2-22f0a802f14e';
UPDATE tournaments SET start_time='2026-11-02 05:59:59+00' WHERE id='04ba4cca-c6a1-45a3-bd3c-5150b43e963b';
UPDATE tournaments SET entry_contract_locked=true WHERE id='069ccf16-2b6f-4eb1-b980-a875860c4b44';
UPDATE tournaments SET guaranteed_prize=1999 WHERE id='0778af66-7924-44dd-b537-56af19adf1ad';
UPDATE tournaments SET buy_in_amount=180,buy_in_fee=20,guaranteed_prize=25000 WHERE id='077ae84a-0f9f-4bde-b02d-a071a2651176';
