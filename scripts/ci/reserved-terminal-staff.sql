-- Only the zero-value staff grants created by the maintained post-deploy
-- preparers may leave. The retired fixture's historical owner is retained.
SELECT
 EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
   WHERE p.id=$1::uuid AND p.email=u.email AND p.role='user' AND p.status='active'
   AND NOT COALESCE(p.is_admin,false) AND NOT COALESCE(p.is_horse,false))
 AND NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.user_id=$1::uuid AND
   (m.chip_balance IS DISTINCT FROM 0 OR m.promo_balance IS DISTINCT FROM 0
    OR m.held_chips IS DISTINCT FROM 0 OR m.locked_chips IS DISTINCT FROM 0
    OR m.credit_used IS DISTINCT FROM 0 OR m.credit_limit IS DISTINCT FROM 0
    OR m.diamonds IS DISTINCT FROM 0 OR m.agent_id IS NOT NULL OR m.parent_agent_id IS NOT NULL
    OR NOT ((m.club_id=$2::uuid AND m.role='owner') OR
      (m.club_id=ANY($3::uuid[]) AND m.role='admin' AND m.status='active'
       AND m.is_active=true AND m.membership_lifecycle_status='active')) IS TRUE))
 AND NOT EXISTS(SELECT 1 FROM public.clubs WHERE owner_id=$1::uuid AND id<>$2::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.unions WHERE owner_id=$1::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.union_admins WHERE user_id=$1::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.agents WHERE user_id=$1::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.club_members WHERE user_id<>$1::uuid
   AND (agent_id=$1::uuid OR parent_agent_id=$1::uuid))
 AND NOT EXISTS(SELECT 1 FROM public.wallets WHERE user_id=$1::uuid
   AND (balance IS DISTINCT FROM 0 OR locked_balance IS DISTINCT FROM 0))
 AND NOT EXISTS(SELECT 1 FROM public.diamond_wallets WHERE user_id=$1::uuid AND balance IS DISTINCT FROM 0)
 AND NOT EXISTS(SELECT 1 FROM public.table_seats WHERE user_id=$1::uuid AND left_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE user_id=$1::uuid
   AND lower(COALESCE(status,'')) IN ('registered','playing'))
 AND NOT EXISTS(SELECT 1 FROM public.cashout_requests WHERE (player_id=$1::uuid OR agent_id=$1::uuid)
   AND status IN ('pending','approved'))
 AND NOT EXISTS(SELECT 1 FROM public.chip_requests WHERE (requester_id=$1::uuid OR approver_id=$1::uuid)
   AND status='pending')
 AND NOT EXISTS(SELECT 1 FROM public.chip_escrow WHERE player_id=$1::uuid AND released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.chip_escrow_holds WHERE user_id=$1::uuid AND status='held')
 AND NOT EXISTS(SELECT 1 FROM public.tournament_tickets WHERE holder_id=$1::uuid AND status='issued')
 AS safe_staff_retirement,
 ARRAY(SELECT club_id FROM public.club_members WHERE user_id=$1::uuid AND club_id<>$2::uuid ORDER BY club_id)
 AS prepared_club_ids;
