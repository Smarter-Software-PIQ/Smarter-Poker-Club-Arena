-- 20261116044800_a_shared_mystery_chest_settles_in_the_whole_chips_it_was_split_in
--
-- A SHARED MYSTERY CHEST SETTLES IN THE WHOLE CHIPS IT WAS SPLIT IN
--
-- Incidents 32401e24 (TournamentBountyRecoveryLaneFailing),
-- 2df6b652 (TournamentBountyOutboxBacklogStuck) and 53d8ad77
-- (fn_ca_bust_backlog_page, Prime Time Free Buy 6b80eaac), 2026-11-16 04:24 UTC.
--
-- WHAT WAS WRONG
-- 20261022170421 (Dan 2026-10-22: "a shared chest divides in whole chips")
-- changed fn_mystery_bounty_reserve to split a chest at
-- GREATEST(100, fn_ca_tournament_unit_cents(...)) - whole chips, remainder
-- to the first claimant by user id. It did NOT change the exact-settled
-- proof fn_bounty_obligation_has_complete_marker, which still expected the
-- split at the money unit (one cent for a chip event). The two agree
-- whenever a chest divides evenly in whole chips, which is why it hid for
-- three weeks (the only other shared chest since, 38 chips / 2, did).
--
-- A split-pot knockout at 04:24:19 shared an 11-chip chest between two
-- players. The writer recorded 6 + 5 chips; the proof demanded 5.50 + 5.50.
-- fn_mystery_bounty_pay paid both, saw no exact marker, raised, and rolled
-- the whole payment back - correctly, but forever: obligation 2ebe8562 sat
-- pending at 17 attempts. That one obligation is the recovery-lane failure
-- and the stuck outbox. Every later bust in the event waits for the bounty
-- lane, so 27 busts piled up unrecorded and no table could break - the
-- bust-backlog page.
--
-- WHAT THIS CHANGES
-- The mystery_chest branch of the proof now accepts a split that exactly
-- matches EITHER canonical cut: the whole-chip cut the current writer makes,
-- or the money-unit cut the writer made before 2026-10-22 (so every chest
-- settled under the old rule still proves). Each is exact per claimant;
-- any other split still fails. For a Diamond event the two cuts are the
-- same unit. The regular/PKO branch is byte-identical.
--
-- MEASURED BEFORE INSTALL (production, 04:45 UTC, pg_temp copy of this body)
--   - obligation 2ebe8562 (6 + 5 of 1100 cents) proves once paid: true
--   - all 2,555 settled mystery_chest obligations: old proof true 2,555,
--     new proof true 2,555, regressions 0.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $preimage$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=
      'public.fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure)
       IS DISTINCT FROM '663946f381864909b4bef1b7755e37b6' THEN
    RAISE EXCEPTION 'fn_bounty_obligation_has_complete_marker changed; qualify current source';
  END IF;
END $preimage$;

CREATE OR REPLACE FUNCTION public.fn_bounty_obligation_has_complete_marker(p_obligation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- DIAMOND PHASE 9: the expected split is taken at the event's unit
  -- (fn_ca_tournament_unit_cents: a cent for a chip event; a whole Diamond
  -- for a Diamond event). A mystery chest splits into unit-floored equal
  -- shares with the remainder to the first claimant by user id; a regular or
  -- PKO head splits into unit-floored equal shares with the remainder to the
  -- last claimant, and a PKO cash half is the unit-floored half of the share.
  -- WHOLE CHIPS (Dan 2026-10-22, 20261116044800): a shared mystery chest is
  -- cut at GREATEST(100, unit) by fn_mystery_bounty_reserve. The proof
  -- accepts that cut, or the money-unit cut a chest reserved before
  -- 2026-10-22 was given - exactly one of them, claimant by claimant.
  SELECT COALESCE((
    SELECT CASE WHEN o.mode='mystery_chest' THEN
      EXISTS (
        SELECT 1 FROM public.tournament_bounty_awards a
         WHERE a.bounty_obligation_id=o.id AND a.status='completed'
           AND (SELECT COALESCE(sum(r.amount_cents),0)
                  FROM public.tournament_bounty_award_recipients r
                 WHERE r.award_id=a.id AND r.paid_at IS NOT NULL)=a.amount_cents
           AND EXISTS (
             SELECT 1
               FROM (SELECT DISTINCT v.unit FROM (VALUES
                       (public.fn_ca_tournament_unit_cents(o.tournament_id)),
                       (GREATEST(100, public.fn_ca_tournament_unit_cents(o.tournament_id)))
                     ) v(unit)) u
              WHERE NOT EXISTS (
                SELECT 1
                  FROM (
                    SELECT claimant_id,ordinal,claimant_count,
                           CASE WHEN u.unit = 1 THEN
                             floor(a.amount_cents / claimant_count)
                               + CASE WHEN ordinal <= mod(a.amount_cents,claimant_count)
                                      THEN 1 ELSE 0 END
                           ELSE
                             public.fn_ca_unit_floor_cents(floor(a.amount_cents / claimant_count)::bigint, u.unit)
                               + CASE WHEN ordinal = 1
                                      THEN a.amount_cents
                                           - public.fn_ca_unit_floor_cents(floor(a.amount_cents / claimant_count)::bigint, u.unit) * claimant_count
                                      ELSE 0 END
                           END AS expected_cents
                      FROM (
                        SELECT (c->>'user_id')::uuid AS claimant_id,
                               row_number() OVER (ORDER BY c->>'user_id') AS ordinal,
                               count(*) OVER () AS claimant_count
                          FROM jsonb_array_elements(o.claimants) c
                      ) ordered_claimants
                  ) expected
                 WHERE NOT EXISTS (
                   SELECT 1 FROM public.tournament_bounty_award_recipients r
                    WHERE r.award_id=a.id AND r.user_id=expected.claimant_id
                      AND r.amount_cents=expected.expected_cents
                      AND r.paid_at IS NOT NULL
                 )
              )
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.tournament_bounty_award_recipients r
              WHERE r.award_id=a.id
                AND (r.paid_at IS NULL OR NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(o.claimants) c
                   WHERE (c->>'user_id')::uuid=r.user_id
                ))
           )
      )
    ELSE
      NOT EXISTS (
        SELECT 1
          FROM (
            SELECT claimant_id, ordinal, claimant_count, u.unit,
                   CASE WHEN ordinal < claimant_count
                        THEN public.fn_ca_unit_floor_cents(floor(head_cents / claimant_count)::bigint, u.unit)
                        ELSE head_cents
                             - public.fn_ca_unit_floor_cents(floor(head_cents / claimant_count)::bigint, u.unit) * (claimant_count - 1)
                   END AS expected_cents
              FROM (
                SELECT (c->>'user_id')::uuid AS claimant_id,
                       row_number() OVER (ORDER BY c->>'user_id') AS ordinal,
                       count(*) OVER () AS claimant_count,
                       round(o.head_amount * 100)::bigint AS head_cents
                  FROM jsonb_array_elements(o.claimants) c
              ) ordered_claimants
              CROSS JOIN (SELECT public.fn_ca_tournament_unit_cents(o.tournament_id) AS unit) u
          ) expected
         WHERE expected.expected_cents > 0
           AND NOT EXISTS (
           SELECT 1 FROM public.tournament_bounties b
            WHERE b.bounty_obligation_id=o.id
              AND b.collector_player_id=expected.claimant_id
              AND round(b.bounty_amount * 100)::bigint=expected.expected_cents
              AND round(COALESCE(b.added_to_collector_bounty,0) * 100)::bigint=
                    CASE WHEN o.mode='pko'
                         THEN expected.expected_cents
                              - public.fn_ca_unit_floor_cents(floor(expected.expected_cents/2.0)::bigint, expected.unit)
                         ELSE 0 END
              AND round((b.bounty_amount-COALESCE(b.added_to_collector_bounty,0))*100)::bigint=
                    CASE WHEN o.mode='pko'
                         THEN public.fn_ca_unit_floor_cents(floor(expected.expected_cents/2.0)::bigint, expected.unit)
                         ELSE expected.expected_cents END
         )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.tournament_bounties b
         WHERE b.bounty_obligation_id=o.id
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(o.claimants) c
              WHERE (c->>'user_id')::uuid=b.collector_player_id
           )
      )
      AND round(COALESCE((
        SELECT sum(b.bounty_amount) FROM public.tournament_bounties b
         WHERE b.bounty_obligation_id=o.id
      ),0),2)=round(o.head_amount,2)
    END
      FROM public.tournament_bounty_obligations o
     WHERE o.id=p_obligation_id
  ),false);
$function$;

REVOKE ALL ON FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_obligation_has_complete_marker(uuid) TO service_role;

DO $postcheck$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tournament_bounty_obligations o
     WHERE o.mode='mystery_chest' AND o.state='settled'
       AND NOT public.fn_bounty_obligation_has_complete_marker(o.id)) THEN
    RAISE EXCEPTION 'a settled mystery chest no longer proves; nothing installed';
  END IF;
END $postcheck$;
COMMIT;