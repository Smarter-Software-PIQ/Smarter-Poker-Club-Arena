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
