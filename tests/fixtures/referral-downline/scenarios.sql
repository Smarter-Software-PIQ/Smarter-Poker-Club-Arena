\set ON_ERROR_STOP on
-- ── Cast ────────────────────────────────────────────────────────────────────
-- 1 owner (KINGFISH)  2 super agent  3 sub agent under 2  4 plain member
-- 10.. players
INSERT INTO public.profiles(id,username,player_number) VALUES
 (u(1),'kingfish','1'),(u(2),'superagent','2'),(u(3),'subagent','3'),
 (u(4),'plainmember','4'),(u(5),'deletedagent','5'),
 (u(10),'p_referred_by_agent','10'),(u(11),'p_no_evidence','11'),
 (u(12),'p_referred_by_plainmember','12'),(u(13),'p_legacy','13'),
 (u(14),'p_blocked_selfref','14'),(u(15),'p_referred_by_subagent','15'),
 (u(16),'p_referrer_becomes_agent_later','16'),(u(17),'p_manual_transfer','17');
UPDATE public.profiles SET status='deleted' WHERE id=u(5);

INSERT INTO public.clubs(id,name,owner_id) VALUES (u(100),'KINGS CLUB',u(1));

INSERT INTO public.club_members(club_id,user_id,role,agent_id) VALUES
 (u(100),u(1),'owner',NULL),
 (u(100),u(2),'super_agent',u(1)),
 (u(100),u(3),'sub_agent',u(2)),
 (u(100),u(4),'player',u(1)),
 (u(100),u(5),'agent',u(1));

INSERT INTO public.agents(user_id,club_id,role,status) VALUES
 (u(2),u(100),'super_agent','active'),
 (u(3),u(100),'sub_agent','active'),
 (u(5),u(100),'agent','active');

-- Evidence: clicked invite links
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at) VALUES
 ('AGENTLINK',u(100),u(2),u(10),'joined',now()-interval '2h',now()-interval '2h'),
 ('PLAINLINK',u(100),u(4),u(12),'joined',now()-interval '2h',now()-interval '2h'),
 ('SUBLINK',  u(100),u(3),u(15),'joined',now()-interval '2h',now()-interval '2h'),
 ('LATERLINK',u(100),u(4),u(16),'joined',now()-interval '2h',now()-interval '2h'),
 ('SELFLINK', u(100),u(2),u(14),'blocked',now()-interval '2h',now()-interval '2h');
UPDATE public.club_invite_attributions SET block_reason='same_device' WHERE user_id=u(14);
-- the blocked player ALSO has a surviving platform referral naming the same inviter
INSERT INTO public.referrals(referrer_id,referee_id,referral_code_used) VALUES (u(2),u(14),'2');
UPDATE public.profiles SET referred_by=u(2) WHERE id=u(14);

-- A legacy row: already under the owner, written before the migration, no source.
INSERT INTO public.club_members(club_id,user_id,role,agent_id,invited_by)
 VALUES (u(100),u(13),'player',u(1),NULL);
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at)
 VALUES ('LEGACYLINK',u(100),u(2),u(13),'joined',now()-interval '30d',now()-interval '30d');

-- A manual transfer: deliberately placed, recorded in the operations log.
-- Deliberate placement under the owner, recorded only in the operations log --
-- which is how a pre-migration transfer looks. The placement test must still
-- read it as chosen.
INSERT INTO public.club_members(club_id,user_id,role,agent_id)
 VALUES (u(100),u(17),'player',u(1));
INSERT INTO public.club_assignment_operations(id,club_id,actor_id,destination_user_id,member_user_ids)
 VALUES (gen_random_uuid(),u(100),u(1),u(1),ARRAY[u(17)]);
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at)
 VALUES ('XFERLINK',u(100),u(2),u(17),'joined',now()-interval '10d',now()-interval '10d');

-- ═══ A PRODUCTION-SHAPED CHECKPOINT ════════════════════════════════════════
-- Production carries ten applied rows in the correction ledger when this
-- migration installs. Without them suite checks 1-4 filter to nothing and read
-- 0 = 0 - present but proving nothing. These seed the same shape: four players
-- already corrected to their referrer (one of them to a SUB-AGENT, so check 4's
-- sub-agent join is non-empty), and the matching agent-parent row.
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

INSERT INTO public.profiles(id,username,player_number) VALUES
 (u(50),'fixed_to_superagent','50'),
 (u(51),'fixed_to_subagent','51');
INSERT INTO public.club_members(club_id,user_id,role,agent_id) VALUES
 (u(100),u(50),'player',u(2)),
 (u(100),u(51),'player',u(3));
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at) VALUES
 ('FIXED50',u(100),u(2),u(50),'joined',now()-interval '1d',now()-interval '1d'),
 ('FIXED51',u(100),u(3),u(51),'joined',now()-interval '1d',now()-interval '1d');
INSERT INTO public.kings_club_downline_repair_20261108
 (scope,subject_user_id,subject_username,old_value,new_value,evidence,applied) VALUES
 ('club_members.agent_id',u(50),'fixed_to_superagent',u(1),u(2),'clicked invite link FIXED50',true),
 ('club_members.agent_id',u(51),'fixed_to_subagent',  u(1),u(3),'clicked invite link FIXED51',true);
-- And the agent-parent half, for the member who is an agent in their own right.
INSERT INTO public.agents(user_id,club_id,role,status,parent_agent_id)
 SELECT u(51),u(100),'agent','active',a.id FROM public.agents a
  WHERE a.club_id=u(100) AND a.user_id=u(3);
INSERT INTO public.kings_club_downline_repair_20261108
 (scope,subject_user_id,agent_row_id,new_value,evidence,applied)
 SELECT 'agents.parent_agent_id',u(51),ag.id,
        (SELECT p.id FROM public.agents p WHERE p.club_id=u(100) AND p.user_id=u(3)),
        'clicked invite link FIXED51',true
   FROM public.agents ag WHERE ag.club_id=u(100) AND ag.user_id=u(51);
