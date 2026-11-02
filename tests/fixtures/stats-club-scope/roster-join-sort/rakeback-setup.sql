-- Model effective terms at the existing authority boundary, with explicit zero.
ALTER TABLE roster_fixture ADD COLUMN management_club_id uuid;
UPDATE roster_fixture SET management_club_id = club_id;
CREATE FUNCTION public.fn_player_rakeback_rate(p_user uuid, p_club uuid)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM roster_fixture WHERE user_id=p_user AND club_id=p_club AND NOT can_view_financials) THEN
  RAISE EXCEPTION 'Private terms must not be evaluated';
 END IF;
 IF p_club <> '00000000-0000-0000-0000-000000000001'::uuid THEN
  RAISE EXCEPTION 'Wrong management club';
 END IF;
 RETURN CASE p_user::text WHEN '00000000-0000-0000-0000-000000000001' THEN 0
 WHEN '00000000-0000-0000-0000-000000000002' THEN 0.325 ELSE 0.7 END;
END $$;
UPDATE roster_fixture SET can_view_financials=false WHERE user_id='00000000-0000-0000-0000-000000000003';
