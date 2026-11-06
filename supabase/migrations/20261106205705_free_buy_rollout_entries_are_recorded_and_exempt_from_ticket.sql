-- 20261106205705_free_buy_rollout_entries_are_recorded_and_exempt_from_ticket
--
-- Reserved by scripts/new-migration.mjs on 2026-11-06.
--
-- THE FREE BUY ENTRIES MADE BEFORE TICKETS WENT LIVE ARE RECORDED, AND ONLY
-- THOSE RECORDED ENTRIES ARE EXEMPT FROM THE TICKET CHECK
--
-- Owner rule (2026-11-05): "Preserve valid entries created before ticket
-- deployment. Record their approved sponsored first-entry benefit without
-- charging those players again." Owner, 2026-11-06 14:52 CT: "Record the 38
-- grandfathered entries so ticket alerts apply the approved exception
-- correctly."
--
-- READ FROM PRODUCTION 2026-11-06 21:10 UTC
--
--  * 20261105223835 (five Free Buy tickets) was reserved at 22:38:35 UTC but
--    actually installed at 23:18:46 UTC: the first redemption is
--    2026-11-05 23:18:47.016829 UTC (registration made 23:18:46.9654).
--  * Every Midway Free Buy registration made before that moment holds no
--    ticket and holds its one-chip promo head from the #9515 door
--    ('tourney:<event>:promo_head:<registration>'): 927 entries in six events
--    (74ba8130 236, 1d115ff4 198, dce71e3f 152, f4793b0d 149, b3ae52ef 105,
--    f777b273 87). None was charged; none used a ticket.
--  * The "38" are the subset registered inside the install gap, after the
--    version timestamp and before the first redemption (f777b273 33,
--    1d115ff4 3, 74ba8130 2). They are recorded with in_install_gap = true;
--    the exemption is the same for all 927.
--  * No Free Buy registration made after 23:18:46.9654 UTC lacks a ticket.
--
-- WHAT THIS CHANGES (no chips move)
--
--  1. smarter_private.free_buy_rollout_entries records each of those entries
--     once: registration, player, event, registration time, the promo head
--     ledger row that funded it, and whether it was in the install gap. It is
--     append-only (no UPDATE or DELETE grant to any role) and keyed by
--     registration, so the record cannot double.
--  2. fn_ca_free_buy_funding_watch's entry_without_ticket check exempts
--     exactly the recorded registrations instead of everything registered
--     before a timestamp. Any other ticketless Free Buy entry, at any time,
--     is reported. Nothing else in the watch changes; it stays read-only.
--
-- @live-proof: to_regclass('smarter_private.free_buy_rollout_entries') IS NOT NULL AND (SELECT count(*) FROM smarter_private.free_buy_rollout_entries) BETWEEN 900 AND 927 AND position('free_buy_rollout_entries' in pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure))
     IS DISTINCT FROM '20bc5bd0a7cae423b46ff45732e0df50' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_free_buy_funding_watch';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_midway_free_buy_format(uuid)'::regprocedure))
     IS DISTINCT FROM 'f9522dffe07a3d8d446e5e3bebd11f68' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_format';
  END IF;
  IF to_regclass('smarter_private.free_buy_rollout_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'Free Buy rollout entries already recorded';
  END IF;
END $pre$;

CREATE TABLE smarter_private.free_buy_rollout_entries (
  registration_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  registered_at timestamptz NOT NULL,
  promo_head_ledger_id uuid NOT NULL,
  in_install_gap boolean NOT NULL,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
COMMENT ON TABLE smarter_private.free_buy_rollout_entries IS
 'Midway Free Buy first entries registered before Free Buy tickets went live (first redemption 2026-11-05 23:18:46.9654 UTC). Each kept its one-chip promo head, used no ticket and was not charged (owner rule 2026-11-05). in_install_gap: registered between the 20261105223835 version time (22:38:35 UTC) and the real install. Append-only.';
REVOKE ALL ON smarter_private.free_buy_rollout_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON smarter_private.free_buy_rollout_entries TO service_role;

DO $record$
DECLARE
  c_tickets_live constant timestamptz := '2026-11-05 23:18:46.9654+00';
  c_version_time constant timestamptz := '2026-11-05 22:38:35+00';
  v_n integer; v_gap integer; v_late integer;
BEGIN
  INSERT INTO smarter_private.free_buy_rollout_entries
    (registration_id, user_id, tournament_id, registered_at, promo_head_ledger_id, in_install_gap, reason)
  SELECT p.id, p.user_id, p.tournament_id, p.registered_at, l.id,
         p.registered_at > c_version_time,
         'Registered before Free Buy tickets went live; kept its promo-funded first entry (owner rule 2026-11-05).'
    FROM public.tournament_players p
    JOIN public.tournaments t ON t.id = p.tournament_id
    JOIN public.chip_ledger l ON l.idempotency_key = 'tourney:' || t.id::text || ':promo_head:' || p.id::text
   WHERE coalesce(t.free_buy, false)
     AND public.fn_ca_midway_free_buy_format(t.id) IS NOT NULL
     AND t.start_time >= '2026-11-05 22:25:02+00'
     AND p.registered_at < c_tickets_live
     AND l.category = 'promo_send'
     AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
                      WHERE r.registration_id = p.id AND r.returned_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT count(*) FILTER (WHERE in_install_gap) INTO v_gap FROM smarter_private.free_buy_rollout_entries;
  -- Read 21:10 UTC: 927 entries, 38 in the gap. An unplayed pre-install
  -- player may unregister before this installs (their row and head are then
  -- gone), so the totals may only fall, never rise.
  IF v_n NOT BETWEEN 900 AND 927 OR v_gap NOT BETWEEN 30 AND 38 THEN
    RAISE EXCEPTION 'Free Buy rollout entries read % (gap %), expected 900-927 (gap 30-38)', v_n, v_gap;
  END IF;
  -- Nothing registered after the real install may be recorded as rollout.
  SELECT count(*) INTO v_late FROM smarter_private.free_buy_rollout_entries WHERE registered_at >= c_tickets_live;
  IF v_late <> 0 THEN RAISE EXCEPTION '% rollout entries registered after tickets went live', v_late; END IF;
END
$record$;

DO $watch$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure);
  a constant text := E'       AND p.registered_at >= c_tickets_live AND p.registered_at < v_grace\n'
                  || E'       AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r\n'
                  || E'                        WHERE r.registration_id = p.id AND r.returned_at IS NULL)\n';
  b constant text := E'       AND p.registered_at < v_grace\n'
                  || E'       AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r\n'
                  || E'                        WHERE r.registration_id = p.id AND r.returned_at IS NULL)\n'
                  || E'       -- The approved exception is a record, not a clock (20261106205705).\n'
                  || E'       AND NOT EXISTS (SELECT 1 FROM smarter_private.free_buy_rollout_entries g\n'
                  || E'                        WHERE g.registration_id = p.id)\n';
BEGIN
  IF (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_free_buy_funding_watch entry_without_ticket anchor not found exactly once';
  END IF;
  EXECUTE replace(v_def, a, b);
END
$watch$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_funding_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_funding_watch() TO service_role;

COMMIT;
