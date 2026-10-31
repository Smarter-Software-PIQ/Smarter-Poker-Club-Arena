-- Production's state before 20261024223153 ran, on top of the October 23
-- fixture: the columns the rake-share readers read, a pg_cron stand-in, the
-- hand-written 520.52 row, and WooWoo's hands either side of the cutoff
-- (2026-10-24 22:21:59.97593 UTC). No credentials; a disposable database only.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.rake_attributions
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN rake_amount numeric,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN rake_record_id uuid;
CREATE TABLE public.rake_records(id uuid PRIMARY KEY, created_at timestamptz);
CREATE FUNCTION public.fn_ca_launch_accounting_accepts(uuid, timestamptz)
  RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_job bigint) RETURNS boolean
  LANGUAGE plpgsql AS $$ BEGIN DELETE FROM cron.job WHERE jobid = p_job; RETURN FOUND; END $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean
  LANGUAGE plpgsql AS $$ BEGIN DELETE FROM cron.job WHERE jobname = p_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job %', p_name; END IF; RETURN true; END $$;

-- Written by hand in production, with no migration.
INSERT INTO smarter_private.player_fee_redemptions
  (operation_key, club_id, user_id, effective_on, amount_cents, reason, recorded_at)
VALUES ('woowoo-half-earned-rake-20261024', 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
  '69f2cefa-017d-49f3-ac3e-61505633747c', '2026-10-24', 52052,
  'Owner-directed (Dan, 2026-10-24): remove 50% of WooWoo''s current earned rake (1041.03 net after the Oct 23 redemption -> 520.52 removed) and stop crediting him for half of his fees. Reporting redemption only; no refund and no change to settled financial records.',
  '2026-10-24 22:21:59.97593+00');

-- Historical A and the declared one-off events stay on their immutable dates.
-- Anchor the shared cases to two recent, fully closed UTC days so both remain
-- inside the real rolling seven-day guard at every subsequent wall-clock date.
-- B is at 23:00; C crosses midnight by two hours. Persist one transaction-derived
-- anchor for the later psql invocation's ended-rule boundary.
CREATE TABLE public.rake_share_fixture_clock AS
  SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::date - 2 AS day;
-- A: before the cutoff (never shared). B: after it, funded by a KINGS buy-in
-- receipt. C: the next UTC day, funded through its rake attribution.
INSERT INTO public.ca_hand_facts VALUES
 ('69f2cefa-017d-49f3-ac3e-61505633747c','fade0000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a',null,'2026-10-24 20:00:00+00',7.00,0.5),
 ('69f2cefa-017d-49f3-ac3e-61505633747c','fade0000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b',null,((SELECT day FROM rake_share_fixture_clock) + time '23:00') AT TIME ZONE 'UTC',89.48,0.5),
 ('69f2cefa-017d-49f3-ac3e-61505633747c','fade0000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000c',null,((SELECT day + 1 FROM rake_share_fixture_clock) + time '01:00') AT TIME ZONE 'UTC',10.00,0.5);
INSERT INTO public.cash_participant_funding_receipts VALUES
 (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','69f2cefa-017d-49f3-ac3e-61505633747c',((SELECT day FROM rake_share_fixture_clock) + time '22:59') AT TIME ZONE 'UTC','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','buyin',((SELECT day FROM rake_share_fixture_clock) + time '22:59') AT TIME ZONE 'UTC');
INSERT INTO public.rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES
 ('00000000-0000-0000-0000-00000000000a','69f2cefa-017d-49f3-ac3e-61505633747c','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',7.00,'2026-10-24 20:00:03+00'),
 ('00000000-0000-0000-0000-00000000000b','69f2cefa-017d-49f3-ac3e-61505633747c','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',89.48,((SELECT day FROM rake_share_fixture_clock) + time '23:00:03') AT TIME ZONE 'UTC'),
 ('00000000-0000-0000-0000-00000000000c','69f2cefa-017d-49f3-ac3e-61505633747c','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',10.00,((SELECT day + 1 FROM rake_share_fixture_clock) + time '01:00:03') AT TIME ZONE 'UTC');
INSERT INTO public.ca_club_rake_daily_user VALUES
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','69f2cefa-017d-49f3-ac3e-61505633747c','2026-10-24',700),
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','69f2cefa-017d-49f3-ac3e-61505633747c',(SELECT day FROM rake_share_fixture_clock),8948),
 ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','69f2cefa-017d-49f3-ac3e-61505633747c',(SELECT day + 1 FROM rake_share_fixture_clock),1000);

DO $$
DECLARE
  anchor date := (SELECT day FROM public.rake_share_fixture_clock);
  b timestamptz; c timestamptz;
BEGIN
  SELECT played_at INTO STRICT b FROM ca_hand_facts WHERE hand_id='00000000-0000-0000-0000-00000000000b';
  SELECT played_at INTO STRICT c FROM ca_hand_facts WHERE hand_id='00000000-0000-0000-0000-00000000000c';
  ASSERT b = ((anchor + time '23:00') AT TIME ZONE 'UTC')
     AND c = (((anchor + 1) + time '01:00') AT TIME ZONE 'UTC')
     AND c - b = interval '2 hours', 'shared cases keep their UTC midnight ordering';
  ASSERT b >= now() - interval '7 days' AND c < now(), 'both shared cases stay in the real seven-day window';
  ASSERT (SELECT played_at FROM ca_hand_facts WHERE hand_id='00000000-0000-0000-0000-00000000000a')
       < '2026-10-24 22:21:59.97593+00'::timestamptz, 'historical A stays before the immutable cutoff';
  ASSERT (SELECT seat_joined_at = b - interval '1 minute' AND recorded_at = seat_joined_at
          FROM cash_participant_funding_receipts WHERE table_id='00000000-0000-0000-0000-0000000000b1'),
    'B keeps its preceding authoritative funding receipt';
  ASSERT (SELECT created_at FROM rake_attributions WHERE hand_id='00000000-0000-0000-0000-00000000000b') = b + interval '3 seconds'
     AND (SELECT created_at FROM rake_attributions WHERE hand_id='00000000-0000-0000-0000-00000000000c') = c + interval '3 seconds',
    'attribution offsets stay exact';
  ASSERT (SELECT sum(rake_cents) FROM ca_club_rake_daily_user
          WHERE user_id='69f2cefa-017d-49f3-ac3e-61505633747c' AND day=anchor) = 8948
     AND (SELECT sum(rake_cents) FROM ca_club_rake_daily_user
          WHERE user_id='69f2cefa-017d-49f3-ac3e-61505633747c' AND day=anchor+1) = 1000,
    'daily aggregates retain the same B/C amounts and UTC days';
END $$;
