-- 20261102035836_player_management_effective_rakeback
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 03:58:36 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- Player Management shows effective own-play rakeback beside each authorized member.
-- Resolve only visible rows through the existing rate authority. No agreement writes,
-- financial changes, new grants, or changes to roster privacy, search or pagination.
-- @live-proof: position('effective_rakeback_rate' in pg_get_functiondef('public.ca_club_members_page(uuid,text,text,text,jsonb,integer)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $install$
DECLARE
  definition text;
  old_expression text := $old$to_jsonb(v) - ARRAY['search_rank', 'joined_sort', 'sort_name', 'presence_rank', 'activity_epoch', 'wallet_total', 'rn']::text[]$old$;
  new_expression text := $new$(to_jsonb(v) - ARRAY['search_rank', 'joined_sort', 'sort_name', 'presence_rank', 'activity_epoch', 'wallet_total', 'rn']::text[])
        || jsonb_build_object('effective_rakeback_rate',
          CASE WHEN v.can_view_financials THEN
            public.fn_player_rakeback_rate(v.user_id, v.management_club_id)
          ELSE NULL END)$new$;
BEGIN
  SELECT pg_get_functiondef('public.ca_club_members_page(uuid,text,text,text,jsonb,integer)'::regprocedure) INTO definition;
  IF md5(definition) <> '26534151abe40fb79489066fb10bcc05' THEN
    RAISE EXCEPTION 'Roster rakeback source preimage changed';
  END IF;
  IF (length(definition) - length(replace(definition, old_expression, ''))) / length(old_expression) <> 1 THEN
    RAISE EXCEPTION 'Roster rakeback projection must occur exactly once';
  END IF;
  EXECUTE replace(definition, old_expression, new_expression);
END
$install$;
COMMIT;
