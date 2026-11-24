-- Disposable PostgreSQL 17 database for the bomb-pot hand result proof.
-- Only the hand_history columns the hand fact readers read, as production
-- types them (hand_history.bomb_pot is jsonb, NULL outside a bomb pot).
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $roles$;

CREATE TABLE public.hand_history (
  id uuid PRIMARY KEY,
  tournament_id uuid,
  game_variant text,
  big_blind numeric(20,2),
  small_blind numeric(20,2),
  pot_size numeric(20,2),
  button_seat integer,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  players jsonb,
  actions jsonb,
  winners jsonb,
  bomb_pot jsonb
);
CREATE INDEX idx_hand_history_bomb_pot_created ON public.hand_history (created_at) WHERE bomb_pot IS NOT NULL;

-- The stored per-hand stat rows (the money columns the recompute may touch,
-- and the columns that identify a row). Filled from the OLD readers below.
CREATE TABLE public.ca_hand_player_stat (
  user_id uuid NOT NULL,
  hand_id uuid NOT NULL,
  asset text NOT NULL DEFAULT 'chips',
  created_at timestamptz,
  my_blind numeric,
  invested_actions numeric,
  won_amt numeric,
  profit numeric,
  vpip boolean,
  PRIMARY KEY (user_id, hand_id)
);
CREATE INDEX idx_ca_hand_player_stat_hand_id ON public.ca_hand_player_stat (hand_id);
