-- Preserve the historical closed-day split proof explicitly when the fixture's
-- B/C dates move: the immutable migration's Oct24 IF EXISTS is now conditional
-- on historical data, while these two real cron rows must always be present.
DO $$
DECLARE anchor date := (SELECT day FROM public.rake_share_fixture_clock);
BEGIN
  ASSERT (SELECT amount_cents FROM smarter_private.player_fee_redemptions
          WHERE operation_key='woowoo-half-split-' || anchor AND effective_on=anchor) = 4474,
    'B closed-day cron split remains exactly44.74';
  ASSERT (SELECT amount_cents FROM smarter_private.player_fee_redemptions
          WHERE operation_key='woowoo-half-split-' || (anchor+1) AND effective_on=anchor+1) = 500,
    'C closed-day cron split remains exactly5.00';
  ASSERT (SELECT amount_cents FROM smarter_private.player_fee_redemptions
          WHERE operation_key='kingfish-from-woowoo-split-' || anchor AND effective_on=anchor) = -4474
     AND (SELECT amount_cents FROM smarter_private.player_fee_redemptions
          WHERE operation_key='kingfish-from-woowoo-split-' || (anchor+1) AND effective_on=anchor+1) = -500,
    'closed-day companion credits retain equal opposite cents';
END $$;

-- D: a hand the five-minute cron has not seen yet - the lag the root fix
-- removes. Played now, funded through its rake attribution.
INSERT INTO public.ca_hand_facts VALUES
 ('69f2cefa-017d-49f3-ac3e-61505633747c','fade0000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000d',null,now(),3.02,0.5);
INSERT INTO public.rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES
 ('00000000-0000-0000-0000-00000000000d','69f2cefa-017d-49f3-ac3e-61505633747c','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',3.02,now());
INSERT INTO public.ca_club_rake_daily_user VALUES
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','69f2cefa-017d-49f3-ac3e-61505633747c',(now() AT TIME ZONE 'UTC')::date,302);
