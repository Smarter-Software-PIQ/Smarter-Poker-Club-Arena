-- 20261118165323_a_cashout_to_your_own_agent_is_not_a_chip_dump.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A CASHOUT TO YOUR OWN AGENT IS NOT A CHIP DUMP, AND A MISFIRE CLOSES ON A
-- RE-MEASUREMENT (reliability incident 47bd20d1, fn_union_integrity_sweep)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~16:40 UTC)
--
-- The union integrity sweep (cron job 123, hourly :33) kept the money_integrity
-- incident for union fade0000... escalated since 2026-11-16. 14 of its
-- financial alerts are open, the oldest from 2026-10-23, and the sweep has no
-- close path at all. Every "direct chip transfer" it raised was a misfire:
--   * 2026-11-16 and 2026-11-17: player 62e39fcf -> eed278a8, 73.23 and
--     "146.46 in 2 transfers". eed278a8 is that player's own assigned
--     super_agent (club_members.agent_id, metadata.assigned_agent_id) and the
--     rows are the cashier's cashout_request_escrow and cashout_approved for
--     ONE 73.23 cashout, so each cashout is counted twice.
--   * 2026-11-10/11: player abe28116 -> the same agent, the same pair of
--     cashier documents for one 120.80 cashout ("241.60 in 2 transfers").
--   * 2026-11-15: 8573a91a -> 2e8073d8, 25.00, an agent_wallet_claim_back: the
--     player's own agent taking credit back.
--   * 2026-10-24: 1784b507 -> 47965354, 20.00, a cashout_approved whose
--     receiver is the club OWNER who approved it as cashier.
-- The deny-list excluded agent_to_player_transfer, buyin, cashout and the club
-- bank faces, but not the cashier documents or the agent credit route, and its
-- agent test looked only at the SENDER. Over 30 days every one of the 13
-- cashout_request_escrow and 8 of 9 cashout_approved rows went to the sender's
-- own agent.
--
-- THE FIX (the definition, in one place, and a close only on re-measurement)
--
-- 1. public.fn_union_transfer_counts_as_dump(chip_transactions) is the one
--    definition of a player-to-player dump: the same deny-list and sender test
--    as before, plus the cashier's documents (cashout_request_escrow,
--    cashout_approved, cashout_denied: the cashout itself, already excluded as
--    'cashout'), "the receiver is not the sender's own agent in that club"
--    (club_members.agent_id) and "the receiver is not the cashier's assigned
--    agent" (metadata.assigned_agent_id). A peer_transfer between unrelated
--    players still counts (one remains in the 2026-10-24 window and its alert
--    stays open).
-- 2. fn_union_integrity_sweep's direct-transfer read uses that definition.
-- 3. The sweep closes an open alert of its union whose ONLY signals are direct
--    transfers once its own window, re-read through the same definition, holds
--    no dump. Of the 14 open alerts that closes 3 (2026-10-23, 11-16, 11-17).
--    An alert that also names a winning agent roster or a co-seating pair is a
--    review item for a person and stays open; this file decides none of them.
--
-- No money moves. No alert is written by this file; the hourly sweep makes the
-- close after install.
--
-- @live-proof: to_regprocedure('public.fn_union_transfer_counts_as_dump(public.chip_transactions)') IS NOT NULL AND position('fn_union_transfer_counts_as_dump(ct)' in pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'::regprocedure)) > 0 AND position('A MISFIRE CLOSES ON A RE-MEASUREMENT' in pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. One definition of a player-to-player dump.
CREATE OR REPLACE FUNCTION public.fn_union_transfer_counts_as_dump(p_ct public.chip_transactions)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $f$
  SELECT p_ct.from_user_id IS NOT NULL AND p_ct.to_user_id IS NOT NULL
     AND p_ct.transaction_type NOT IN ('agent_to_player_transfer','rakeback','buyin','cashout',
       -- A club bank claim or send names the owner as the face of the bank
       -- (2026-10-12, 2026-10-16): not a player transfer.
       'club_bank_claim','club_bank_send',
       -- A CASHOUT TO YOUR OWN AGENT IS NOT A CHIP DUMP (20261118165323): the
       -- cashier's documents move a player's cashout to the club's cashier
       -- (the assigned agent, or the owner or agent who approved it). They are
       -- the cashout itself, which was always excluded as 'cashout'.
       'cashout_request_escrow','cashout_approved','cashout_denied')
     -- An agent sending to a player is the agent route, not a dump.
     AND NOT EXISTS (SELECT 1 FROM public.agents a
                      WHERE a.user_id = p_ct.from_user_id AND a.club_id = p_ct.club_id)
     -- The agent credit route (an agent claiming credit back, and any other
     -- movement to the agent the club assigned this player) is not a dump.
     AND NOT EXISTS (SELECT 1 FROM public.club_members m
                      WHERE m.user_id = p_ct.from_user_id AND m.club_id = p_ct.club_id
                        AND m.agent_id = p_ct.to_user_id)
     AND (p_ct.metadata->>'assigned_agent_id') IS DISTINCT FROM p_ct.to_user_id::text
$f$;

REVOKE ALL ON FUNCTION public.fn_union_transfer_counts_as_dump(public.chip_transactions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_transfer_counts_as_dump(public.chip_transactions) TO service_role;

-- The pinned-text substitution (the form 20261118073646 uses). Already the
-- postimage: a no-op, never a refusal.
CREATE FUNCTION pg_temp.union_subst(p_sig text, p_before text, p_after text,
                                    p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- 2 and 3. The sweep reads that definition, and closes a misfire it re-measured.
SELECT pg_temp.union_subst(
  'public.fn_union_integrity_sweep(uuid,integer)',
  '93765162c4d5e216947137b27862446f', '5405e7e915005d18df43dcc8056f3eb0',
  ARRAY[
$o1$       AND ct.from_user_id IS NOT NULL AND ct.to_user_id IS NOT NULL
       AND ct.transaction_type NOT IN ('agent_to_player_transfer','rakeback','buyin','cashout',
         -- A CLUB BANK CLAIM IS NOT A PLAYER TRANSFER (2026-10-12): to_user_id
         -- names the owner as the face of the club bank the chips went into.
         'club_bank_claim',
         -- A CLUB BANK SEND IS NOT A PLAYER TRANSFER EITHER (2026-10-16): the
         -- chips leave the club bank (metadata bank_before/bank_after), and
         -- from_user_id names the owner as the face of that bank, exactly as
         -- to_user_id does on a claim. The owner's 2026-10-15 horse wallet
         -- reset (one send of 10,000 to every live horse from four club
         -- banks) was raised as 739 "direct chip transfers" from the owner.
         'club_bank_send')
       AND NOT EXISTS (SELECT 1 FROM agents a
         WHERE a.user_id=ct.from_user_id AND a.club_id=ct.club_id)
$o1$,
$o2$  RETURN jsonb_build_object(
    'union_id', p_union_id, 'window_hours', p_hours, 'signals', v_total,
$o2$],
  ARRAY[
$n1$       AND public.fn_union_transfer_counts_as_dump(ct)
$n1$,
$n2$  /* A MISFIRE CLOSES ON A RE-MEASUREMENT (20261118165323). An open sweep alert of
     this union whose only signals are direct chip transfers closes once its own
     window, read again through fn_union_transfer_counts_as_dump, holds no dump:
     every transfer it named was the sender's own cashout through the club's
     cashier or the agent credit route. An alert that also names a winning agent roster or a
     co-seating pair stays open: those are review items for a person. */
  UPDATE financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = 'verified: re-measured over its own window; none of its direct chip transfers is a player-to-player dump (each was the sender''s own cashout through the club cashier or the agent credit route)'
   WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved
     AND a.context->>'union_id' = p_union_id::text
     AND jsonb_array_length(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) = 0
     AND jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0
     AND NOT EXISTS (
       SELECT 1 FROM chip_transactions ct
        WHERE ct.created_at >= a.created_at - make_interval(hours => GREATEST(COALESCE((a.context->>'window_hours')::int, 24), 1))
          AND ct.created_at <= a.created_at
          AND (EXISTS (SELECT 1 FROM public.union_clubs uc
                 WHERE uc.union_id=p_union_id AND uc.club_id=ct.club_id)
            OR EXISTS (SELECT 1 FROM public.clubs c
                 WHERE c.id=p_union_id AND c.is_union IS TRUE AND c.id=ct.club_id))
          AND public.fn_union_transfer_counts_as_dump(ct));

  RETURN jsonb_build_object(
    'union_id', p_union_id, 'window_hours', p_hours, 'signals', v_total,
$n2$]);

COMMIT;
