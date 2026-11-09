-- Minimal fixture for the referral-downline behavioural test.
-- Only what the migration touches: the two hierarchy representations, the four
-- evidence sources, and faithful stubs of the five functions it patches.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth._who(uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT uid FROM auth._who LIMIT 1$$;

CREATE FUNCTION u(n int) RETURNS uuid LANGUAGE sql IMMUTABLE
  AS $$SELECT lpad(n::text,32,'0')::uuid$$;

CREATE TABLE public.profiles(
  id uuid PRIMARY KEY, username text, player_number text,
  referred_by uuid, status text DEFAULT 'active', alias text);

CREATE TABLE public.clubs(
  id uuid PRIMARY KEY, name text, owner_id uuid,
  requires_approval boolean DEFAULT false, asset text DEFAULT 'chips',
  lifecycle_status text DEFAULT 'active');

CREATE TABLE public.club_members(
  club_id uuid, user_id uuid, role text DEFAULT 'player', agent_id uuid,
  parent_agent_id uuid, invited_by uuid, status text DEFAULT 'active',
  membership_lifecycle_status text DEFAULT 'active',
  tier text, rank_level int, orange_ball_status text, chip_balance numeric DEFAULT 0,
  is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (club_id, user_id));

CREATE TABLE public.agents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, club_id uuid,
  role text, status text DEFAULT 'active', parent_agent_id uuid,
  total_players int DEFAULT 0, active_player_count int DEFAULT 0,
  updated_at timestamptz DEFAULT now());

CREATE TABLE public.club_invite_attributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, club_id uuid,
  inviter_id uuid, user_id uuid, status text, block_reason text,
  first_clicked_at timestamptz, claimed_at timestamptz, joined_at timestamptz,
  UNIQUE (user_id, club_id));

CREATE TABLE public.club_invite_links(code text, club_id uuid, inviter_id uuid);

CREATE TABLE public.referrals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_id uuid,
  referee_id uuid, referral_code_used text, created_at timestamptz DEFAULT now());

CREATE TABLE public.club_assignment_operations(
  id uuid PRIMARY KEY, club_id uuid, actor_id uuid, destination_user_id uuid,
  source_user_id uuid, member_user_ids uuid[]);

-- Platform helpers the migration calls, with their real semantics.
CREATE FUNCTION public.fn_cashier_member_is_active(p_club uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_members m
                  JOIN public.profiles p ON p.id = m.user_id
                  WHERE m.club_id = p_club AND m.user_id = p_user
                    AND m.status IN ('active','approved')
                    AND COALESCE(p.status,'active') <> 'deleted')
$$;

CREATE FUNCTION public.fn_club_is_in_downline(p_club_id uuid, p_upline_user_id uuid, p_member_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE chain(parent,depth,path) AS (
  SELECT m.agent_id,1,ARRAY[m.user_id] FROM public.club_members m
  WHERE m.club_id=p_club_id AND m.user_id=p_member_user_id AND m.agent_id IS NOT NULL
   AND p_upline_user_id IS NOT NULL AND p_member_user_id IS NOT NULL
   AND p_upline_user_id<>p_member_user_id
  UNION ALL
  SELECT m.agent_id,c.depth+1,c.path||m.user_id FROM chain c
  JOIN public.club_members m ON m.club_id=p_club_id AND m.user_id=c.parent
  WHERE c.depth<20 AND m.agent_id IS NOT NULL AND NOT m.user_id=ANY(c.path)
 ) SELECT EXISTS(SELECT 1 FROM chain WHERE parent=p_upline_user_id)
$$;

CREATE FUNCTION public.fn_club_membership_lock(p_user uuid) RETURNS void
  LANGUAGE sql AS $$SELECT NULL::void$$;
CREATE FUNCTION public.fn_club_membership_count(p_user uuid) RETURNS int
  LANGUAGE sql AS $$SELECT 0$$;
CREATE FUNCTION public.fn_club_membership_cap() RETURNS int
  LANGUAGE sql AS $$SELECT 4$$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean
  LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.fn_can_manage_club_assignments(p_club uuid) RETURNS boolean
  LANGUAGE sql AS $$SELECT true$$;
