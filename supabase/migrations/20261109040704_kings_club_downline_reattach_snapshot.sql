CREATE TABLE IF NOT EXISTS public.kings_club_downline_repair_20261108 (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL,
  subject_user_id uuid NOT NULL,
  subject_username text,
  agent_row_id uuid,
  old_value uuid,
  new_value uuid,
  old_username text,
  new_username text,
  evidence text,
  applied boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.kings_club_downline_repair_20261108 IS
 'Rollback snapshot for the 2026-11-08 Kings Club downline reattachment. scope=club_members.agent_id or agents.parent_agent_id. old_value is the pre-repair value; restoring old_value reverses the change.';