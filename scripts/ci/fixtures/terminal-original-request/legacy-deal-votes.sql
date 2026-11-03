-- Private legacy consent fixture, used only while exact proposal authority is inactive.
BEGIN;
INSERT INTO public.ca_settle_sources(source,note) VALUES('final_table_deal','fn_final_table_deal') ON CONFLICT DO NOTHING;
INSERT INTO public.tournament_deal_votes(tournament_id,user_id) SELECT tournament_id,user_id FROM public.tournament_players WHERE tournament_id='92010000-0000-0000-0000-000000000001';
COMMIT;
