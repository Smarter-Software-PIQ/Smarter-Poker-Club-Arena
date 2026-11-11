\set ON_ERROR_STOP on
-- Four games the activation must treat differently, each with one live table:
--   eligible   Classic nlh at 1.00 BB in an active chips club  -> floored
--   too cheap  Classic nlh at 0.50 BB                          -> untouched
--   Madness    nlh at 2.00 BB                                   -> untouched
--   retired    Classic nlh at 1.00 BB in a retired club         -> untouched
INSERT INTO public.clubs (id, name, asset, lifecycle_status) VALUES
  ('aaaa0000-0000-0000-0000-000000000001','Active Chips Club','chips','active'),
  ('aaaa0000-0000-0000-0000-000000000002','Retired Club','chips','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cash_games (id, club_id, template_name, variant, sb, bb, ruleset_snapshot) VALUES
  ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','classic','nlh',0.5,1.0,'{}'::jsonb),
  ('bbbb0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','classic','nlh',0.25,0.5,'{}'::jsonb),
  ('bbbb0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000001','madness','nlh',1.0,2.0,'{}'::jsonb),
  ('bbbb0000-0000-0000-0000-000000000004','aaaa0000-0000-0000-0000-000000000002','classic','nlh',0.5,1.0,'{}'::jsonb);

-- The tables start UNFLOORED on purpose: activation has to be what floors them,
-- not the row that created them.
INSERT INTO public.tables (id, cluster_id, club_id, name, game_variant, big_blind, status,
                           nit_game, maintain_percent_min, maintain_hands) VALUES
  ('cccc0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','NLH 0.50/1 Classic A','nlh',1.0,'running',false,0,10),
  ('cccc0000-0000-0000-0000-000000000002','bbbb0000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','NLH 0.25/0.50 Classic A','nlh',0.5,'running',false,0,10),
  ('cccc0000-0000-0000-0000-000000000003','bbbb0000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000001','NLH 1/2 Madness A','nlh',2.0,'running',true,40,10),
  ('cccc0000-0000-0000-0000-000000000004','bbbb0000-0000-0000-0000-000000000004','aaaa0000-0000-0000-0000-000000000002','NLH 0.50/1 Classic R','nlh',1.0,'running',false,0,10);

-- Retire the club only NOW. A game cannot be created in a retired club in the
-- first place (fn_guard_retired_club_mutation refuses any non-DELETE on
-- cash_games for a retired club), so the faithful shape is a game that existed
-- while its club was active and a club retired afterwards. Activation must
-- leave it alone: writing to it would be refused, and its records are
-- read-only.
UPDATE public.clubs SET lifecycle_status = 'retired'
 WHERE id = 'aaaa0000-0000-0000-0000-000000000002';
