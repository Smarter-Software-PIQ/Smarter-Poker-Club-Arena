-- Only the disposable native window-route cluster owns these relations.
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  starting_chips integer,
  rebuy_chips integer,
  addon_chips integer,
  is_rebuy boolean,
  is_reentry boolean,
  add_on_available boolean,
  rebuy_cost numeric,
  addon_cost numeric,
  seed_bad_awards boolean DEFAULT false
);
CREATE TABLE public.tournament_players (tournament_id uuid);
CREATE TABLE public.ca_declared_money_triggers (
  table_name text,trigger_name text,note text,UNIQUE(table_name,trigger_name)
);
GRANT ALL ON public.tournaments, public.tournament_players TO service_role;

-- A pre-existing historical contract must survive a no-op. Fixtures are
-- inserted before installing either implementation, never by bypassing one.
INSERT INTO public.tournaments(id,starting_chips,rebuy_chips,addon_chips,
  is_rebuy,is_reentry,add_on_available)
VALUES('10000000-0000-0000-0000-000000000003',15000,10000,80000,true,true,true);
INSERT INTO public.tournament_players(tournament_id)
VALUES('10000000-0000-0000-0000-000000000003');

-- Models an earlier producer trigger writing awards in response to another
-- column. UPDATE OF award-column lists do not observe that change.
CREATE FUNCTION public.fixture_seed_awards() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seed_bad_awards THEN NEW.rebuy_chips:=10000; NEW.addon_chips:=80000; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER a3_fixture_seed_awards BEFORE UPDATE OF seed_bad_awards
ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.fixture_seed_awards();
