-- ═══════════════════════════════════════════════════════════════════════
-- 20261119014500_messenger_invoice_attention_ids.sql
-- ═══════════════════════════════════════════════════════════════════════
-- TIER:        1
-- AUTHOR:      Claude (agent/claude-inboxfn)
-- AFFECTS:     one new read-only function
-- IRREVERSIBLE: no
--
-- WHY:
--   The Messenger main inbox now reads a window of each inbox instead of
--   every thread the person ever had. An invoice that still requires action
--   must never fall outside that window. The existing reader,
--   fn_messenger_private_invoice_attention(p_user_id, p_conversation_ids),
--   answers for at most 100 named threads, so finding every action-required
--   invoice with it means asking about every invoice, which is the unbounded
--   load being removed.
--
-- HOW (high level):
--   Adds fn_messenger_private_invoice_attention_ids(p_user_id): the same
--   joins, the same active-membership check and the same requires_action
--   expression as the installed reader, over all of the caller's invoice
--   threads, returning only the ids whose answer is true. It is a selection
--   hint. Whether a listed thread requires action is still said by
--   fn_messenger_private_invoice_attention. Service-role only, like it: the
--   Pages API authenticates the actor and supplies that verified user id.
--   The application treats a missing function as "unknown" and reads every
--   invoice, so this file may be installed before or after the code deploys.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regclass('public.accounting_conversations') IS NULL
     OR to_regclass('public.accounting_invoice_deliveries') IS NULL
     OR to_regclass('public.settlement_invoices') IS NULL
     OR to_regclass('public.social_messages') IS NULL
     OR to_regclass('public.club_members') IS NULL
     OR to_regclass('public.accounting_cashier_events') IS NULL
     OR to_regclass('public.cashout_requests') IS NULL
     OR to_regprocedure('public.fn_messenger_private_invoice_attention(uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Messenger invoice attention ids require the private accounting delivery schema and its attention reader';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.fn_messenger_private_invoice_attention_ids(
  p_user_id uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Messenger invoice attention request' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(due.conversation_id), ARRAY[]::uuid[])
    INTO v_ids
    FROM (
      SELECT ac.conversation_id
        FROM public.accounting_conversations ac
        LEFT JOIN public.social_messages m
          ON m.conversation_id = ac.conversation_id
        LEFT JOIN public.accounting_invoice_deliveries d
          ON d.message_id = m.id
         AND d.recipient_id = p_user_id
        LEFT JOIN public.settlement_invoices i
          ON i.id = d.invoice_id
       WHERE ac.recipient_id = p_user_id
         AND EXISTS (
           SELECT 1
             FROM public.club_members cm
            WHERE cm.club_id = ac.scope_id
              AND cm.user_id = p_user_id
              AND cm.is_active
              AND cm.membership_lifecycle_status = 'active'
              AND cm.status IN ('active', 'approved')
         )
       GROUP BY ac.conversation_id
      HAVING COALESCE(bool_or(
               COALESCE(d.delivery_mode, 'immediate') <> 'weekly_detail'
               AND i.status IN ('pending', 'generated', 'overdue')
               AND (i.invoice_type IS DISTINCT FROM 'cashier_cashout' OR EXISTS (
                 SELECT 1
                   FROM public.accounting_cashier_events ce
                   JOIN public.cashout_requests cr ON cr.id = ce.cashout_id
                  WHERE ce.invoice_id = i.id
                    AND ce.event_kind = 'hold'
                    AND cr.status = 'pending'
                    AND cr.player_id <> p_user_id))
             ), false)
    ) due;
  RETURN v_ids;
END
$function$;

ALTER FUNCTION public.fn_messenger_private_invoice_attention_ids(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_messenger_private_invoice_attention_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_messenger_private_invoice_attention_ids(uuid) TO service_role;

DO $postflight$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.fn_messenger_private_invoice_attention_ids(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_messenger_private_invoice_attention_ids(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_messenger_private_invoice_attention_ids(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Messenger invoice attention ids grants are incorrect';
  END IF;
  IF (SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.fn_messenger_private_invoice_attention_ids(uuid)'::regprocedure) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Messenger invoice attention ids must be SECURITY DEFINER';
  END IF;
  -- The new reader and the installed one must agree, thread by thread, for
  -- the account with the most invoice threads.
  IF EXISTS (
    WITH subject AS (
      SELECT recipient_id FROM public.accounting_conversations GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
    ), sample AS (
      SELECT ac.conversation_id, s.recipient_id
        FROM public.accounting_conversations ac JOIN subject s ON s.recipient_id = ac.recipient_id
       ORDER BY ac.conversation_id LIMIT 100
    )
    SELECT 1
      FROM subject s
      CROSS JOIN LATERAL public.fn_messenger_private_invoice_attention(
        s.recipient_id, ARRAY(SELECT conversation_id FROM sample)) existing
     WHERE existing.requires_action IS DISTINCT FROM
           (existing.conversation_id = ANY(public.fn_messenger_private_invoice_attention_ids(s.recipient_id)))
  ) THEN
    RAISE EXCEPTION 'Messenger invoice attention ids disagree with the installed attention reader';
  END IF;
END
$postflight$;

COMMIT;
