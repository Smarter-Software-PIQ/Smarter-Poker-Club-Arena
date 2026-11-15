-- Native fixture for scripts/ci/test-club-data-union-invoice-week.py.
-- Only the relations and functions 20261114235606 / 20261114235607 read.
-- fn_union_week_start and fn_ca_club_data_clubs are production's definitions
-- (pg_get_functiondef, 2026-11-14); ca_can_view_whole_club_report is a stand-in
-- that answers from a session setting, because authorization is not what this
-- fixture qualifies.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE TABLE public.clubs (id uuid PRIMARY KEY, name text, slug text UNIQUE);
CREATE TABLE public.unions (id uuid PRIMARY KEY, name text);
CREATE TABLE public.union_clubs (union_id uuid NOT NULL, club_id uuid NOT NULL, PRIMARY KEY (union_id, club_id));
CREATE TABLE public.ca_horse_club_assignments (horse_id uuid PRIMARY KEY, club_id uuid NOT NULL);
CREATE TABLE public.settlement_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, union_id uuid,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, status text);
CREATE TABLE public.settlement_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL, period_id uuid NOT NULL,
  invoice_type text NOT NULL, invoice_number text, status text NOT NULL DEFAULT 'generated',
  breakdown jsonb NOT NULL);
CREATE UNIQUE INDEX settlement_invoices_weekly ON public.settlement_invoices (club_id, period_id, invoice_type)
  WHERE invoice_type = 'union_weekly_squareup';

CREATE FUNCTION public.fn_union_week_start(p_at timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT date_trunc('week', (p_at AT TIME ZONE 'America/Los_Angeles'))
           AT TIME ZONE 'America/Los_Angeles';
$function$;

CREATE FUNCTION public.fn_ca_club_data_clubs(p_club_id uuid)
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.unions u WHERE u.id=p_club_id)
 THEN ARRAY(SELECT x.id FROM (SELECT p_club_id id UNION SELECT uc.club_id FROM public.union_clubs uc WHERE uc.union_id=p_club_id) x ORDER BY x.id)
 ELSE ARRAY[p_club_id] END;
$function$;

CREATE FUNCTION public.ca_can_view_whole_club_report(p_club_id uuid)
 RETURNS boolean LANGUAGE sql STABLE AS $function$
  SELECT COALESCE(current_setting('test.can_view', true), 'on') = 'on';
$function$;

INSERT INTO public.unions VALUES ('fade0000-0000-0000-0000-000000000001', 'Midway Union');
INSERT INTO public.clubs VALUES
  ('fade0000-0000-0000-0000-000000000001', 'Midway Union', 'midway-union'),
  ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', 'KINGS CLUB', 'kings-club-1'),
  ('a0000000-0000-0000-0000-000000000001', 'The Felt Society', 'the-felt-society'),
  ('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3', 'Deep Stack Society', 'deep-stack-society'),
  ('946747c6-b991-4220-b0cb-effbea46ecd2', 'Club Savage', 'club-savage'),
  ('5ca1ab1e-0000-0000-0000-000000000001', 'Standalone Club', 'standalone');
INSERT INTO public.union_clubs
SELECT 'fade0000-0000-0000-0000-000000000001', c.id FROM public.clubs c
 WHERE c.id NOT IN ('fade0000-0000-0000-0000-000000000001', '5ca1ab1e-0000-0000-0000-000000000001');

-- The issued invoices. Week 2026-11-02 is production's, figure for figure
-- (settlement_invoices.breakdown read on 2026-11-14; issued before
-- weekly_player_results existed, so the documents carry no cash/tournament
-- split). Week 2026-10-26 is synthetic and carries the split; it starts at
-- 07:00Z because Chicago was still on daylight time.
CREATE FUNCTION pg_temp.issue(p_club uuid, p_from timestamptz, p_to timestamptz, p_no text,
                              p_rake numeric, p_won numeric, p_rb numeric, p_split jsonb, p_status text DEFAULT 'generated')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_period uuid;
BEGIN
  INSERT INTO public.settlement_periods (club_id, union_id, start_at, end_at, status)
  VALUES (p_club, 'fade0000-0000-0000-0000-000000000001', p_from, p_to, 'processing') RETURNING id INTO v_period;
  INSERT INTO public.settlement_invoices (club_id, period_id, invoice_type, invoice_number, status, breakdown)
  VALUES (p_club, v_period, 'union_weekly_squareup', p_no, p_status,
    jsonb_build_object('union_id', 'fade0000-0000-0000-0000-000000000001', 'club_id', p_club,
      'club_name', (SELECT name FROM public.clubs WHERE id = p_club),
      'period_start', p_from, 'period_end', p_to,
      'rake_generated', p_rake, 'players_won', p_won, 'rakeback_due', p_rb)
    || COALESCE(p_split, '{}'::jsonb));
END $$;

SELECT pg_temp.issue('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-11-02 08:00+00', '2026-11-09 08:00+00', 'MU-1', 25854.24, -37160.83, 23268.80, NULL);
SELECT pg_temp.issue('a0000000-0000-0000-0000-000000000001', '2026-11-02 08:00+00', '2026-11-09 08:00+00', 'MU-2', 455510.12, -473091.31, 409959.09, NULL);
SELECT pg_temp.issue('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3', '2026-11-02 08:00+00', '2026-11-09 08:00+00', 'MU-3', 452206.43, -562209.57, 406985.78, NULL);
SELECT pg_temp.issue('946747c6-b991-4220-b0cb-effbea46ecd2', '2026-11-02 08:00+00', '2026-11-09 08:00+00', 'MU-4', 0, 0, 0, NULL);
SELECT pg_temp.issue('fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00', '2026-11-09 08:00+00', 'MU-5', 0, 212.51, 0, NULL);
SELECT pg_temp.issue('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-10-26 07:00+00', '2026-11-02 08:00+00', 'MU-0', 1000.10, -250.05, 900.09,
  '{"weekly_player_results":{"version":1,"cash_net_loss":200.03,"tournament_net_loss":50.02,"total_net_loss":250.05,"rakeback_credit":900.09}}');
-- A cancelled document for an earlier week is not an issued invoice.
SELECT pg_temp.issue('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-10-19 07:00+00', '2026-10-26 07:00+00', 'MU-X', 77, -77, 7, NULL, 'cancelled');
-- A horse currently assigned to another club than the one that earned.
INSERT INTO public.ca_horse_club_assignments VALUES ('0000aaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
