-- Name every schedule structure after the ladder it already has.
--
-- WHAT THIS CHANGES: the descriptive structure key on active tournament
-- schedules, so it agrees with the level duration the schedule already
-- stores. 5 minutes or less = TURBO, 8 = STANDARD, 10 or more = DEEPSTACK.
-- No ladder, stack, ante, break or late-registration value is touched. The
-- name is moved to the ladder; the ladder is never moved to the name.
--
-- WHY IT IS DDL-FREE: a mislabelled schedule is data, so this is one UPDATE
-- in one transaction. No event trigger fires, PostgREST does not reload, and
-- the :50-:03 UTC DDL exclusion does not apply (CLAUDE.md section 2 rule 8).
-- tournament_schedules is not one of the hot three (clubs, tables,
-- hand_history), so this needs no daily-maintenance window declaration and
-- takes no writer-blocking lock (rule 10).
--
-- WHY "STANDARD" AND NOT "REGULAR": fn_ca_schedule_level_clock_floor is the
-- only function on this database that reads this key, and it recognises
-- exactly one token - upper(blindPreset) = 'STANDARD' yields an 8 minute
-- floor, and EVERY other value falls through to 5. Writing the owner's
-- display name "REGULAR" into the stored key would therefore demote all 38
-- eight-minute schedules to a five-minute floor the moment the owner-sheet
-- bypass stops applying to them. "Regular" is the name a player reads and
-- belongs in the client; STANDARD is the key the database enforces on.
--
-- WHY LIVE EVENTS ARE NOT TOUCHED: on tournament_schedules this key sits
-- beside a stored ladder, so correcting it renames a structure. On
-- public.tournaments it does not - blind_level_state holds only the current
-- level ({index, small_blind, big_blind, ante}; measured 2026-11-09:
-- durationMinutes is absent on all 361 live rows), so there the key is the
-- ladder SELECTOR and rewriting it would change the structure under players
-- who are already registered. The 81 RUNNING and 280 REGISTERING events keep
-- the terms they were sold and inherit the corrected name when their
-- schedule next spawns.

BEGIN;

CREATE TEMP TABLE ca_structure_rename ON COMMIT DROP AS
SELECT s.id,
       COALESCE(s.config->>'blindPreset', '(none)')                    AS old_key,
       (s.config->'blindStructure'->0->>'durationMinutes')::numeric    AS level_minutes,
       CASE
         WHEN (s.config->'blindStructure'->0->>'durationMinutes')::numeric <= 5  THEN 'TURBO'
         WHEN (s.config->'blindStructure'->0->>'durationMinutes')::numeric =  8  THEN 'STANDARD'
         WHEN (s.config->'blindStructure'->0->>'durationMinutes')::numeric >= 10 THEN 'DEEPSTACK'
       END                                                             AS new_key
  FROM public.tournament_schedules s
 WHERE s.active
   AND s.config ? 'blindStructure'
   AND jsonb_typeof(s.config->'blindStructure') = 'array'
   AND jsonb_array_length(s.config->'blindStructure') > 0;

DELETE FROM ca_structure_rename
 WHERE new_key IS NULL
    OR level_minutes IS NULL
    OR old_key = new_key;

-- Assert the board has not moved since this was derived (CLAUDE.md 10.9
-- rule 4). 74 rows were measured on 2026-11-09; abort rather than relabel a
-- set this migration was not written against.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM ca_structure_rename;
  IF v_n = 0 THEN
    RAISE NOTICE 'ca_structure_rename: nothing to correct; already applied';
  ELSIF v_n NOT BETWEEN 60 AND 90 THEN
    RAISE EXCEPTION
      'ca_structure_rename: expected ~74 mislabelled schedules, found %. Re-derive before applying.', v_n
      USING ERRCODE = '22023';
  END IF;
END $$;

UPDATE public.tournament_schedules s
   SET config = jsonb_set(s.config, '{blindPreset}', to_jsonb(r.new_key), true)
  FROM ca_structure_rename r
 WHERE s.id = r.id;

-- The ladder each schedule stores must be byte-identical afterwards: this
-- migration renames, it does not restructure.
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.tournament_schedules s
    JOIN ca_structure_rename r ON r.id = s.id
   WHERE (s.config->'blindStructure'->0->>'durationMinutes')::numeric
         IS DISTINCT FROM r.level_minutes;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ca_structure_rename: % schedule ladders changed during a rename-only migration', v_bad
      USING ERRCODE = '22023';
  END IF;
END $$;

COMMIT;
