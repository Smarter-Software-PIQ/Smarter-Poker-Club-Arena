-- TIER: 2. Read-only Messenger projection; no account, message or financial writes.
-- Successor to the definition 20261116205120 last edited (pg_get_functiondef md5
-- 30f13b0dd7777dd94fb9f363aa8c846f, read on production 2026-11-18 and again
-- 2026-11-19 01:40 UTC).
--
-- The club welcome is sent to every admitted member, and each one opens a
-- one-to-one thread in the sender's personal inbox. Read on production
-- 2026-11-18: one club owner held 1,299 personal threads, and 1,272 of them
-- contained nothing except welcomes that owner had sent. 745 of those still
-- had a counterpart profile; 527 had none and were already unlisted.
--
-- The rule: fn_get_user_conversations does not list a one-to-one thread whose
-- every message is a club welcome sent by the viewer. It is listed again the
-- moment the other person writes anything, or the viewer writes a message of
-- their own. The recipient's inbox is unaffected, because those messages are
-- not theirs. Groups are untouched. The rule reads who sent a message and
-- whether it is a welcome, and nothing about who the member is: every member
-- is still sent the same welcome (CLAUDE.md 10.5).
--
-- Only the WHERE clause gains one predicate. Signature, return columns,
-- ordering, SECURITY DEFINER, search_path, the caller check, the unread count
-- and the ACL are unchanged; the postflight proves the installed definition
-- minus the added predicate is byte-identical to the preimage. No row is
-- written, changed or deleted.
--
-- Cost: one extra probe of idx_messages_conversation (conversation_id,
-- created_at DESC) per listed candidate thread, stopping at the first message
-- that is not the viewer's own welcome.
--
-- DEPENDENCY: World Hub must already authorize opening such a thread (its
-- resolve path accepts a thread that holds only the viewer's own welcomes)
-- before this is installed, or a sender could not open a thread to write the
-- first real message.
--
-- Rollback: install tests/fixtures/messenger-unanswered-welcome/production-inbox.sql
-- (the guarded preimage) in a newly reserved one-transaction migration; never
-- replay installed files.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $preflight$
BEGIN
 IF md5(pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure))
    <> '30f13b0dd7777dd94fb9f363aa8c846f' THEN
  RAISE EXCEPTION 'Messenger unanswered-welcome preimage changed; requalify before installation';
 END IF;
 IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public'
      AND table_name='social_messages' AND column_name='media_metadata') IS DISTINCT FROM 'jsonb' THEN
  RAISE EXCEPTION 'social_messages.media_metadata must be jsonb';
 END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.fn_get_user_conversations(p_user_id uuid, p_context_entity_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(conversation_id uuid, title text, is_group boolean, last_message_at timestamp with time zone, unread_count bigint, other_user_id uuid, other_user_username text, other_user_avatar text, context_entity_id uuid, context_entity_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT public.fn_caller_is_engine() AND (auth.uid() IS NULL OR ( auth.uid() IS DISTINCT FROM p_user_id)) THEN
        RAISE EXCEPTION 'fn_get_user_conversations: not authorized to read another user''s inbox';
    END IF;

    RETURN QUERY
    SELECT inbox.* FROM (
    SELECT
        c.id AS conversation_id,
        COALESCE(c.group_name, NULL) AS title,
        c.is_group,
        c.last_message_at,
        (
            SELECT COUNT(*)
              FROM social_messages m
             WHERE m.conversation_id = c.id
               AND m.sender_id != p_user_id
               AND COALESCE(m.is_deleted, false) = false
               AND NOT EXISTS(SELECT 1 FROM public.messenger_hidden_messages hidden WHERE hidden.user_id=p_user_id AND hidden.message_id=m.id)
               AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        ) AS unread_count,
        ou.id AS other_user_id,
        -- Never nameless: every profile carries a player number.
        COALESCE(
            NULLIF(btrim(ou.display_name), ''),
            NULLIF(btrim(ou.username), ''),
            NULLIF(btrim(ou.alias), ''),
            CASE WHEN ou.id IS NOT NULL THEN 'Player #' || COALESCE(NULLIF(btrim(ou.player_number), ''), left(ou.id::text, 8)) END
        ) AS other_user_username,
        ou.avatar_url AS other_user_avatar,
        p.context_entity_id,
        p.context_entity_type
    FROM social_conversations c
    JOIN social_conversation_participants p
      ON p.conversation_id = c.id AND p.user_id = p_user_id
    LEFT JOIN social_conversation_participants op
      ON op.conversation_id = c.id AND op.user_id <> p_user_id
    LEFT JOIN profiles ou ON ou.id = op.user_id
    WHERE p.context_entity_id IS NOT DISTINCT FROM p_context_entity_id
      -- A one-to-one thread whose other person no longer exists (deleted
      -- account) is never listed or counted: it would render as "Unknown".
      AND (COALESCE(c.is_group, false) OR ou.id IS NOT NULL)
      AND (COALESCE(c.is_group, false) OR NOT EXISTS (
           SELECT 1 FROM auth.users counterpart_account
           WHERE counterpart_account.id = ou.id
             AND counterpart_account.deleted_at IS NOT NULL))
      AND (COALESCE(c.is_group, false)
           OR NOT public.fn_ca_is_cert_account(ou.id)
           OR public.fn_ca_is_cert_account(p_user_id))
      -- A one-to-one thread that holds only the viewer's own club welcome
      -- messages is not listed until the other person writes, or the viewer
      -- writes something of their own. One rule for every recipient.
      AND (COALESCE(c.is_group, false) OR EXISTS (
           SELECT 1 FROM public.social_messages spoken
           WHERE spoken.conversation_id = c.id
             AND (spoken.sender_id IS DISTINCT FROM p_user_id
                  OR spoken.media_metadata->>'club_welcome' IS DISTINCT FROM 'true')))
      AND EXISTS (
        SELECT 1 FROM public.social_messages m
        WHERE m.conversation_id = c.id
          AND NOT EXISTS (
            SELECT 1 FROM public.accounting_invoice_deliveries d
            JOIN public.settlement_invoices si ON si.id = d.invoice_id
            WHERE d.message_id = m.id
              AND COALESCE(si.invoice_type, '') NOT IN ('cashier_cashout', 'union_weekly_squareup', 'union_weekly_credit_note')
              AND NOT EXISTS(SELECT FROM smarter_private.weekly_club_rakeback_documents wd
                WHERE wd.invoice_id=si.id AND d.recipient_id=p_user_id AND p_user_id=ANY(wd.audience))
              AND NOT EXISTS(SELECT FROM public.credit_invoices ci JOIN public.agents a ON a.id=ci.agent_id
                JOIN public.agent_credit_weekly_basis b ON b.agent_id=ci.agent_id AND b.club_id=a.club_id
                  AND b.period_start=ci.period_start AND b.period_end=ci.period_end AND b.credit_line>0
                WHERE ci.id=si.source_credit_invoice_id AND si.club_id=a.club_id
                  AND si.from_entity_type='club' AND si.from_entity_id=a.club_id::text AND si.to_entity_type='agent'
                  AND si.to_entity_id=a.user_id::text AND si.breakdown->>'kind'='credit_invoice'
                  AND d.recipient_id=p_user_id AND p_user_id=a.user_id)
          )
      )
    ) inbox
    ORDER BY (inbox.unread_count > 0) DESC, inbox.last_message_at DESC NULLS LAST;
END;
$function$;
DO $postflight$
DECLARE
 v_added constant text := $added$      -- A one-to-one thread that holds only the viewer's own club welcome
      -- messages is not listed until the other person writes, or the viewer
      -- writes something of their own. One rule for every recipient.
      AND (COALESCE(c.is_group, false) OR EXISTS (
           SELECT 1 FROM public.social_messages spoken
           WHERE spoken.conversation_id = c.id
             AND (spoken.sender_id IS DISTINCT FROM p_user_id
                  OR spoken.media_metadata->>'club_welcome' IS DISTINCT FROM 'true')))
$added$;
BEGIN
 IF position(v_added IN pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'Messenger unanswered-welcome predicate was not installed';
 END IF;
 -- Everything else is the preimage, byte for byte.
 IF md5(replace(pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure), v_added, ''))
    <> '30f13b0dd7777dd94fb9f363aa8c846f' THEN
  RAISE EXCEPTION 'Messenger inbox changed beyond the unanswered-welcome predicate';
 END IF;
END $postflight$;
-- Executed before COMMIT (tests/a-migration-proves-its-functions-before-commit):
-- a migration session is a trusted caller (fn_caller_is_engine), and an
-- unknown user's inbox is empty, so the body runs end to end and writes nothing.
-- @probe-for: public.fn_get_user_conversations
DO $probe$
BEGIN
  PERFORM * FROM public.fn_get_user_conversations(gen_random_uuid(), NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
