-- Function probe: paste after a migration's CREATE OR REPLACE FUNCTION, before COMMIT.
-- Required for every SECURITY DEFINER PL/pgSQL function in public or smarter_private
-- (tests/a-migration-proves-its-functions-before-commit.law.test.ts).
--
-- It executes the new body once inside a subtransaction that is always undone.
-- Only the sentinel is swallowed: any other error, the function's own refusal
-- included, re-raises and rolls the whole migration back, so a body that cannot
-- run never reaches production. Build fixtures inside the block (they are undone
-- with it) and pick arguments that reach the code the migration changed.
-- A plpgsql_check gate in CI covers the paths a probe does not reach.

-- @probe-for: public.fn_example
DO $probe$
BEGIN
  -- fixtures here, e.g. INSERT ... RETURNING id INTO ...
  PERFORM public.fn_example(/* arguments that reach the changed code */);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- A function that cannot run without an effect outside the transaction:
-- -- @probe-exempt: public.fn_example <why, at least 20 characters>
