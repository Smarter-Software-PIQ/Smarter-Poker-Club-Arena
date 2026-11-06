-- Both accounts keep 50 of every new 100; KingFish receives the other half.
DO $$
DECLARE m uuid:='b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216';
 w uuid:='69f2cefa-017d-49f3-ac3e-61505633747c'; k uuid:='47965354-0e56-43ef-931c-ddaab82af765';
 c uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'; before_w numeric; before_k numeric; before_fee_w numeric; before_fee_k numeric;
BEGIN
 before_w:=(ca_player_rake_stats(w)->>'rake_paid')::numeric;
 before_k:=(ca_player_rake_stats(k)->>'rake_paid')::numeric;
 SELECT cash_fees INTO before_fee_w FROM ca_club_member_fee_totals(c,null,null,w);
 SELECT cash_fees INTO before_fee_k FROM ca_club_member_fee_totals(c,null,null,k);
 INSERT INTO ca_hand_facts VALUES(m,c,null,'12345678-0000-0000-0000-000000000001',null,now(),100,2),
 (w,c,null,'12345678-0000-0000-0000-000000000002',null,now(),100,2);
 INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES
 ('12345678-0000-0000-0000-000000000001',m,c,100,now()),('12345678-0000-0000-0000-000000000002',w,c,100,now());
 INSERT INTO ca_club_rake_daily_user VALUES(c,m,(now() AT TIME ZONE 'UTC')::date,10000),(c,w,(now() AT TIME ZONE 'UTC')::date,10000);
 ASSERT (ca_player_rake_stats(m)->>'rake_paid')::numeric=50, 'Mikey must show 50 of 100';
 ASSERT (ca_player_rake_stats_by_club(m,null,'chips',c)->>'rake_paid')::numeric=50, 'Mikey club stats must show 50';
 ASSERT (SELECT cash_fees FROM ca_club_member_fee_totals(c,null,null,m))=50, 'Mikey cash fees must show 50';
 ASSERT (ca_player_rake_stats(w)->>'rake_paid')::numeric=before_w+50, 'WooWoo must keep half';
 ASSERT (ca_player_rake_stats(k)->>'rake_paid')::numeric=before_k+100, 'KingFish must receive both halves';
 ASSERT (SELECT cash_fees FROM ca_club_member_fee_totals(c,null,null,w))=before_fee_w+50, 'WooWoo fees keep half';
 ASSERT (SELECT cash_fees FROM ca_club_member_fee_totals(c,null,null,k))=before_fee_k+100, 'KingFish fees receive both halves';
 ASSERT (ca_player_rake_stats(m)->>'rake_paid')::numeric=50, 'repeat read must never split twice';
END $$;
