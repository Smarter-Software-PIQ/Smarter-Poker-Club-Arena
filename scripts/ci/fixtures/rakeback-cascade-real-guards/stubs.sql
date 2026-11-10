-- STAND-INS. Each one replaces a production function the fixture loaded
-- byte-exact and then overrode here, with the reason. The harness records the
-- production md5 each one hides and fails if a stand-in is not listed in its
-- STAND_INS table.
SET check_function_bodies=off;
-- 1. Round 3 PERFORMs this and discards the result: it re-derives the union's
--    earned plan from rake records, bank legs and the union P&L capture, which
--    the fixture does not build (its sources are written directly). It writes
--    nothing and no money guard reads it.
CREATE OR REPLACE FUNCTION public.fn_accounting_union_earned_plan(p_union_id uuid,p_start timestamptz,p_end timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
-- 2. Round 3's precondition that the weekly PREPARATION job versioned this
--    scope's own-agent interpretation (it compares the md5 of four preparation
--    functions and reads review rows). The fixture writes certificates
--    directly and runs no preparation, so the assertion has nothing to read.
--    It is STABLE, writes nothing, and no money guard reads it.
CREATE OR REPLACE FUNCTION smarter_private.assert_own_agent_scope_interpreted(p_kind text,p_scope uuid,p_from timestamptz,p_to timestamptz,p_round integer) RETURNS void LANGUAGE sql AS $$SELECT$$;
