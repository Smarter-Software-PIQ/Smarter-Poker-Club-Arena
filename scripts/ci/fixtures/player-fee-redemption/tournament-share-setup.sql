-- Minimal source-receipt shape; production's own synchronous rollup trigger
-- is loaded by the harness, so every future receipt reaches both readers.
CREATE TABLE public.accounting_tournament_fee_sources(club_id uuid,player_id uuid,charged_at timestamptz,rake_credit numeric);
ALTER TABLE public.ca_club_member_tournament_fee_daily ADD COLUMN entries bigint DEFAULT 0, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.ca_club_member_tournament_fee_daily ADD PRIMARY KEY(club_id,user_id,day);
-- The existing fixture already contains this historical daily fee.
INSERT INTO public.accounting_tournament_fee_sources VALUES
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','69f2cefa-017d-49f3-ac3e-61505633747c','2026-10-23 12:00Z',3.50);
