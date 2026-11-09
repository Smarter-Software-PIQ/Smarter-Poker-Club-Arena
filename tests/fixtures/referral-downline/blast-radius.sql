\set ON_ERROR_STOP on
-- ═══ D. THE SETTLEMENT BOUND [REVIEW 4] ═════════════════════════════════════
-- Eight movable disagreements must ABORT rather than move them.
DO $$
DECLARE i int; n int;
BEGIN
  FOR i IN 30..37 LOOP
    INSERT INTO public.profiles(id,username,player_number) VALUES (u(i),'bulk'||i,i::text);
    INSERT INTO public.club_members(club_id,user_id,role,agent_id,agent_assignment_source)
      VALUES (u(100),u(i),'player',u(1),'join_fallback');
    INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at)
      VALUES ('BULK'||i,u(100),u(2),u(i),'joined',now(),now());
  END LOOP;
  SELECT count(*) INTO n FROM public.fn_referral_downline_disagreements(u(100));
  IF n < 8 THEN RAISE EXCEPTION 'fixture did not create enough disagreements: %', n; END IF;
  RAISE NOTICE 'PASS  the audit sees all % movable disagreements', n;
END $$;
