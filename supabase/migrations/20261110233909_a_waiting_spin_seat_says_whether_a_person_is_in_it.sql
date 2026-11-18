-- 20261110233909_a_waiting_spin_seat_says_whether_a_person_is_in_it
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-10 23:39:09 UTC.
--
-- @live-proof: (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_spin_unfilled_waits' AND column_name IN ('human_seats','horse_seats','unresolved_seats','oldest_human_seat_at','longest_human_wait')) = 5 AND (SELECT pg_get_functiondef(p.oid) LIKE '%s.horse_id is null and p.is_horse = false%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_spin_fill_waits')
--
-- A WAITING SPIN SEAT SAYS WHETHER A PERSON IS IN IT (2026-11-10,
-- incident 78afb154-54ae-4661-bf7d-e5e3c18a6eb3, alert
-- SpinFleetProducingNothing).
--
-- WHAT WAS WRONG
--
-- Under Dan's seat-first ladder (server/src/config/seatFirstLadder.ts) one
-- horse OPENS a Spin and the board then waits 60-80 minutes for a second
-- horse and a further 30-60 for a third: up to 140 minutes before it deals.
-- Eleven boards are open at once (SPIN_BOARD_OPEN_TARGET), so a partly filled
-- Spin holding one or two seats is the designed steady state, not a backlog.
-- A person who sits is joined within 3-7 minutes (HUMAN_ARRIVAL_MIN/MAX_MS),
-- so the ONLY question that separates the ladder from a seating fault is
-- whether a waiting seat belongs to a person.
--
-- Measured read-only on 2026-11-10 23:23Z during the incident: 11 unfilled
-- boards, 14 waiting seats, 14 of 14 horses, 0 humans. The fleet was working
-- exactly as specified and the alert had paged critical anyway, because
-- nothing it reads can tell a horse-only board from a stalled one.
--
-- v_spin_unfilled_waits is the view every runbook sends the reader to
-- (docs/runbooks/spin-fleet-stalled.md step 2), and it cannot answer that
-- question: it reports live_seats and oldest_seat_at and nothing about who
-- is in the seats. Step 2 therefore offered only "3 live seats" or "0 live
-- seats" and had no case for the designed 1-2 of 3, which is why a healthy
-- fleet read as a seating fault.
--
-- A SECOND, LATENT DEFECT IN THE SAME PREDICATE
--
-- fn_spin_fill_waits (2026-10-03) already splits the population by person,
-- and it does so with `coalesce(p.is_horse, false)` over a LEFT JOIN on
-- table_seats.user_id. That reads an UNRESOLVABLE seat - one with no
-- user_id, or a user_id with no profiles row - as a HUMAN. It happens to be
-- harmless today (all 14 seats resolve, and all 14 also carry a horse_id),
-- but poker_spin_human_oldest_wait_seconds is about to become the trip wire
-- for a critical page, and under the ladder a single unresolvable seat on a
-- board designed to wait 140 minutes would page within the minute, for ever.
-- A seat is a horse when it carries a horse_id OR its profile says so; it is
-- a person only when a profile positively says so. Neither-nor is counted and
-- shown as unresolved rather than silently paging or silently hiding.
--
-- WHAT THIS CHANGES
--
--   1. v_spin_unfilled_waits gains human_seats, horse_seats,
--      unresolved_seats, oldest_human_seat_at and longest_human_wait. The
--      nine existing columns keep their names, types and order, so every
--      reader (fn_spin_metrics counts its rows) is unaffected.
--   2. fn_spin_fill_waits honours table_seats.horse_id and stops treating an
--      unresolvable seat as a person. Signature, volatility, search_path and
--      grants are unchanged, so SpinMetrics reads the same four columns.
--
-- Nothing here branches the GAME rules on is_horse (CLAUDE.md 10.5): a horse
-- occupies a seat exactly as a person does, waits the same ladder and is
-- refunded under the same rules. This is a MEASUREMENT telling the operator
-- who is in the chair, which is the one thing the page needed and lacked.
--
-- No row of any table is read for money, written or deleted. Both objects are
-- replaced in place, both preimages are pinned below, and a preimage another
-- agent has moved raises rather than quietly reverting their work.

BEGIN;

-- ── PREIMAGE PINS ───────────────────────────────────────────────────────────
-- Another writer may hold these objects. Replacing a definition we have not
-- read would silently revert their work, so the exact definitions this
-- migration was written against are pinned. A mismatch stops the install and
-- names the object, which is recoverable; a silent revert is not.
DO $pin$
DECLARE
  v_fn_md5 text;
  v_view_md5 text;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_fn_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_spin_fill_waits';

  IF v_fn_md5 IS DISTINCT FROM '48c2dd2b931210349e412ea139a8a16a' THEN
    RAISE EXCEPTION
      'public.fn_spin_fill_waits has changed since this migration was written (expected md5 48c2dd2b931210349e412ea139a8a16a, found %). Another writer owns it: re-read the live definition, re-apply the horse_id predicate onto it, and re-pin.',
      coalesce(v_fn_md5, 'no such function');
  END IF;

  SELECT md5(pg_get_viewdef('public.v_spin_unfilled_waits'::regclass, true)) INTO v_view_md5;

  IF v_view_md5 IS DISTINCT FROM '5468587ccaac089b79b6eb37163b9bf3' THEN
    RAISE EXCEPTION
      'public.v_spin_unfilled_waits has changed since this migration was written (expected md5 5468587ccaac089b79b6eb37163b9bf3, found %). Another writer owns it: re-read the live definition, append the five seat-identity columns onto it, and re-pin.',
      coalesce(v_view_md5, 'no such view');
  END IF;
END
$pin$;

-- ── 1. THE TRIAGE VIEW ANSWERS THE DECISIVE QUESTION ────────────────────────
-- The nine original columns are reproduced first, in order, with their
-- original expressions (age() for the wait, so the value is unchanged), which
-- is what lets CREATE OR REPLACE append the new five. The five correlated
-- subqueries the original ran per row are replaced by ONE lateral pass over
-- the seats, which is also what makes the identity split affordable.
CREATE OR REPLACE VIEW public.v_spin_unfilled_waits
WITH (security_invoker = true) AS
SELECT
  t.id AS tournament_id,
  t.club_id,
  t.name,
  t.buy_in_amount,
  t.max_players,
  s.live_seats,
  s.oldest_seat_at,
  age(now(), s.oldest_seat_at) AS longest_wait,
  round(t.buy_in_amount * s.live_seats::numeric, 2) AS chips_locked,
  -- WHO IS IN THE SEATS. Disjoint and exhaustive: a seat carrying a horse_id
  -- is a horse whatever its profile says; a seat whose profile says is_horse
  -- is a horse; a seat whose profile positively says otherwise is a person;
  -- anything left is unresolved and is counted as neither.
  s.human_seats,
  s.horse_seats,
  s.unresolved_seats,
  s.oldest_human_seat_at,
  age(now(), s.oldest_human_seat_at) AS longest_human_wait
FROM public.tournaments t
CROSS JOIN LATERAL (
  SELECT
    count(*)::bigint AS live_seats,
    min(ts.joined_at) AS oldest_seat_at,
    count(*) FILTER (WHERE ts.horse_id IS NULL AND p.is_horse = false)::bigint AS human_seats,
    count(*) FILTER (WHERE ts.horse_id IS NOT NULL OR p.is_horse = true)::bigint AS horse_seats,
    count(*) FILTER (WHERE ts.horse_id IS NULL AND p.is_horse IS NULL)::bigint AS unresolved_seats,
    min(ts.joined_at) FILTER (WHERE ts.horse_id IS NULL AND p.is_horse = false) AS oldest_human_seat_at
  FROM public.table_seats ts
  JOIN public.tables tb ON tb.id = ts.table_id
  LEFT JOIN public.profiles p ON p.id = ts.user_id
  WHERE tb.tournament_id = t.id
    AND ts.left_at IS NULL
) s
WHERE t.variant = 'spin'
  AND t.status = ANY (ARRAY['REGISTERING'::text, 'ANNOUNCED'::text])
  AND t.started_at IS NULL
  AND s.live_seats >= 1
  AND s.live_seats <= (COALESCE(t.max_players, 3) - 1);

-- ACCESS, STATED RATHER THAN INHERITED (check-explicit-table-access.mjs).
-- Live grants read 2026-11-10: authenticated SELECT, service_role ALL,
-- postgres (owner) ALL, anon nothing. CREATE OR REPLACE VIEW keeps an ACL, so
-- naming it here changes one thing in production and only one: service_role
-- loses INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on an aggregate view
-- that was never updatable, so nothing could have exercised them. The browser
-- role keeps the SELECT it has had since 20260831060000; the view is
-- security_invoker (restated above), so a signed-in caller still reads it
-- under their own RLS and sees only their own clubs' boards - which is the
-- arrangement 20260831115746 established for exactly this view.
REVOKE ALL ON public.v_spin_unfilled_waits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_spin_unfilled_waits TO authenticated;
GRANT SELECT ON public.v_spin_unfilled_waits TO service_role;

COMMENT ON VIEW public.v_spin_unfilled_waits IS
  'Partly filled, open, unstarted Spins. human_seats / horse_seats / unresolved_seats split the waiting seats by who holds them: under the seat-first ladder a horse-only board at 1-2 of 3 seats is the designed state and only a waiting PERSON is a seating fault. A seat with a horse_id is a horse; a seat whose profile says is_horse = false is a person; neither is unresolved and counted as neither.';

-- ── 2. THE GAUGE PREDICATE STOPS GUESSING ───────────────────────────────────
-- Same signature, same volatility, same search_path, same four columns. Only
-- the seat-identity predicate changes: horse_id is honoured, and an
-- unresolvable seat is no longer reported as a waiting person.
CREATE OR REPLACE FUNCTION public.fn_spin_fill_waits()
 RETURNS TABLE(human_unfilled_waits bigint, human_oldest_wait_seconds numeric, unfilled_past_window bigint, unfilled_oldest_wait_seconds numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with open_spins as (
    select t.id, coalesce(t.max_players, 3) as cap, t.start_time
    from public.tournaments t
    where t.variant = 'spin'
      and t.status in ('REGISTERING', 'ANNOUNCED')
      and t.started_at is null
      -- A Spin an owner floor park refuses to start is held, not unfilled
      -- (2026-10-15, migration 20261015222118).
      and not public.fn_ca_operator_floor_park_holds(t.club_id, t.union_id)
  ),
  seats as (
    select o.id as tournament_id, o.cap, o.start_time, s.joined_at,
           -- A PERSON IS IDENTIFIED, NEVER ASSUMED (2026-11-10). This was
           -- `not coalesce(p.is_horse, false)`, which read a seat with no
           -- user_id - or a user_id with no profiles row - as a person. The
           -- gauge below is the trip wire for a critical page and the ladder
           -- holds a horse-only board for up to 140 minutes, so one
           -- unresolvable seat would have paged every minute for ever.
           -- NULL here means unresolved; `filter (where is_human)` counts it
           -- as neither, which is what v_spin_unfilled_waits.unresolved_seats
           -- is for.
           (s.horse_id is null and p.is_horse = false) as is_human
    from open_spins o
    join public.tables tb on tb.tournament_id = o.id
    join public.table_seats s on s.table_id = tb.id and s.left_at is null
    left join public.profiles p on p.id = s.user_id
  ),
  boards as (
    select tournament_id,
           min(start_time) as window_ends,
           min(joined_at) as oldest_seat_at,
           min(joined_at) filter (where is_human) as oldest_human_seat_at
    from seats
    group by tournament_id, cap
    having count(*) between 1 and cap - 1
  )
  select
    count(*) filter (where oldest_human_seat_at is not null)::bigint,
    coalesce(round(extract(epoch from now() - min(oldest_human_seat_at))::numeric), 0),
    count(*) filter (where window_ends < now() - interval '120 seconds')::bigint,
    coalesce(round(extract(epoch from now() - min(oldest_seat_at))::numeric), 0)
  from boards;
$function$;

COMMENT ON FUNCTION public.fn_spin_fill_waits() IS
  'Splits partly filled, open Spins by who is waiting. A seat is a horse when it carries a horse_id or its profile says is_horse; a person only when a profile positively says is_horse = false. An unresolvable seat is counted as neither - see v_spin_unfilled_waits.unresolved_seats. Feeds poker_spin_human_unfilled_waits and poker_spin_human_oldest_wait_seconds.';

-- ENGINE TELEMETRY, RESTATED. Live grants are already service_role only
-- ({postgres=X/postgres,service_role=X/postgres}, anon and authenticated both
-- false, read 2026-11-10), and CREATE OR REPLACE keeps an existing ACL - so
-- this changes nothing in production. It is here because CREATE FUNCTION on a
-- database where this function does NOT yet exist grants EXECUTE to PUBLIC by
-- default, which would hand an unauthenticated caller a SECURITY DEFINER read
-- past RLS. PUBLIC is named as well as the roles: anon inherits whatever
-- PUBLIC holds, so revoking anon alone reads as a fix and does nothing. Same
-- two lines the function shipped with in 20261003120909.
REVOKE ALL ON FUNCTION public.fn_spin_fill_waits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_spin_fill_waits() TO service_role;

COMMIT;
