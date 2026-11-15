-- THE MYSTERY SEED HANDS THE SEALED LADDER A WHOLE-CENT POOL (2026-11-14).
-- Root cause of fn_ca_tournament_dark_while_running / MttPlayStopped on
-- tournament a5957f99-6060-49e3-a1c5-065b412aec09: migration 20261114072509
-- made fn_mystery_bounty_seed call
--   fn_mystery_sealed_ladder_for_open(uuid, integer, bigint)
-- with sum(bigint), which Postgres types as numeric. No function matches
-- (uuid, integer, numeric), so every mystery activation raised 42883 and an
-- event that reached its activation point could never deal another hand.
-- The sum is cast back to bigint; nothing else in the function changes.
DO $fix$
DECLARE
  v_def text;
  v_old constant text :=
    '(SELECT sum((x->>''amount_cents'')::bigint) FROM jsonb_array_elements(v_norm) x));';
  v_new constant text :=
    '(SELECT sum((x->>''amount_cents'')::bigint)::bigint FROM jsonb_array_elements(v_norm) x));';
  v_hits int;
BEGIN
  SELECT pg_get_functiondef('public.fn_mystery_bounty_seed(uuid, integer, jsonb)'::regprocedure)
    INTO v_def;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'fn_mystery_bounty_seed: expected exactly one uncast sealed-ladder pool argument, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix$;