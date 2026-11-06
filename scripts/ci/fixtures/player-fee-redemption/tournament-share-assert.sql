DO $$
DECLARE c uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
 m uuid:='b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216';
 w uuid:='69f2cefa-017d-49f3-ac3e-61505633747c';
 k uuid:='47965354-0e56-43ef-931c-ddaab82af765';
 before_cash jsonb; before_vip jsonb; row record;
BEGIN
 SELECT jsonb_object_agg(user_id,cash_fees) INTO before_cash FROM ca_club_member_fee_totals(c);
 SELECT jsonb_agg(to_jsonb(x) ORDER BY operation_key) INTO before_vip FROM smarter_private.player_fee_redemptions x;
 -- Entry, rebuy and add-on contributions total 100 per player. Sharing reads
 -- every immutable source receipt without a charge-kind exclusion.
 INSERT INTO accounting_tournament_fee_sources(club_id,player_id,charged_at,rake_credit) VALUES
 (c,m,'2026-10-25 12:00Z',30),(c,m,'2026-10-25 13:00Z',50),(c,m,'2026-10-25 14:00Z',20),
 (c,w,'2026-10-25 12:00Z',30),(c,w,'2026-10-25 13:00Z',50),(c,w,'2026-10-25 14:00Z',20),
 (c,k,'2026-10-25 12:00Z',10),
 (c,'11111111-1111-1111-1111-111111111111','2026-10-25 12:00Z',9);
 ASSERT (SELECT tournament_fees FROM ca_club_member_fee_totals(c,null,null,m))=50,'Mikey tournament 100 must show 50';
 ASSERT (SELECT tournament_fees FROM ca_club_member_fee_totals(c,null,null,w))=51.75,'WooWoo tournament history and new fees both split';
 ASSERT (SELECT tournament_fees FROM ca_club_member_fee_totals(c,null,null,k))=111.75,'KingFish receives both tournament halves plus own fees';
 ASSERT (SELECT tournament_fees FROM ca_club_member_fee_totals(c,null,null,'11111111-1111-1111-1111-111111111111'))=9,'unrelated player unchanged';
 ASSERT (SELECT sum(tournament_fees) FROM ca_club_member_fee_totals(c))=222.50,'tournament credits conserved';
 ASSERT (SELECT jsonb_object_agg(user_id,cash_fees) FROM ca_club_member_fee_totals(c))=before_cash,'cash split preserved';
 ASSERT (SELECT jsonb_agg(to_jsonb(x) ORDER BY operation_key) FROM smarter_private.player_fee_redemptions x)=before_vip,'historical VIP/cash events preserved';
 ASSERT (SELECT total_fees=cash_fees+tournament_fees FROM ca_club_member_fee_totals(c,null,null,m)),'combined total uses net credits';
 ASSERT (SELECT tournament_fees FROM ca_club_member_chicago_fee_totals(c,null,null,w))=51.75,'Overall delegates net tournament credit';
 ASSERT (SELECT tournament_fees FROM ca_club_member_chicago_fee_totals(c,'2026-10-25','2026-10-25',m))=50,'Chicago date-filtered Mikey credit';
 ASSERT (SELECT tournament_fees FROM ca_club_member_chicago_fee_totals(c,'2026-10-25','2026-10-25',w))=50,'Chicago date-filtered WooWoo credit';
 ASSERT (SELECT tournament_fees FROM ca_club_member_chicago_fee_totals(c,'2026-10-25','2026-10-25',k))=110,'Chicago date-filtered recipient credit';
 ASSERT (ca_club_member_statistics(c,m,'nlh')->>'fees')::numeric=50,'variant tournament Mikey100 must show50';
 ASSERT (ca_club_member_statistics(c,w,'nlh')->>'fees')::numeric=51.75,'variant tournament WooWoo history split';
 ASSERT (ca_club_member_statistics(c,k,'nlh')->>'fees')::numeric=111.75,'variant recipient gets both tournament halves';
 ASSERT (ca_club_member_statistics(c,m,'nlh','2026-10-25','2026-10-25')->>'fees')::numeric=50,'dated variant respects split';
 ASSERT (ca_club_member_statistics(c,m,'plo')->>'fees')::numeric=0,'other variant unchanged';
 ASSERT (ca_club_member_statistics(c,m,null)->>'fees')::numeric=(SELECT total_fees FROM ca_club_member_fee_totals(c,null,null,m)),'real statistics Overall uses combined net fees';
 -- Repeated reads never write/split twice; a new source is visible immediately.
 ASSERT (SELECT tournament_fees FROM ca_club_member_fee_totals(c,null,null,m))=50,'repeat read remains 50';
 INSERT INTO accounting_tournament_fee_sources(club_id,player_id,charged_at,rake_credit) VALUES(c,m,'2026-10-26 04:59:59Z',1.01),(c,m,'2026-10-26 05:00:00Z',2);
 ASSERT (SELECT tournament_fees FROM ca_club_member_chicago_fee_totals(c,'2026-10-25','2026-10-25',m))=50.50,'Chicago midnight excludes next day and rounds cents once';
 ASSERT (SELECT tournament_fees FROM ca_club_member_chicago_fee_totals(c,'2026-10-26','2026-10-26',m))=1,'Chicago next day includes boundary';
 ASSERT (SELECT tournament_fees FROM ca_club_member_fee_totals(c,'2026-10-26','2026-10-26',m))=1.50,'UTC daily range uses own day and exact complementary cents';
 ASSERT NOT EXISTS(SELECT 1 FROM ca_club_member_fee_totals('99999999-9999-9999-9999-999999999999')),'other club unaffected';
 ASSERT NOT has_function_privilege('anon','ca_club_member_fee_totals(uuid,date,date,uuid)','EXECUTE'),'anonymous cannot read fees';
 ASSERT NOT has_function_privilege('authenticated','ca_club_member_chicago_fee_totals(uuid,date,date,uuid)','EXECUTE'),'private reader ACL preserved';
END $$;
\echo TOURNAMENT_SHARE PASS: both 100-to-50, KingFish credits, historical and future, source-trigger delivery, UTC/Chicago bounds, exact cents, conserved totals, repeat reads, cash/VIP/ACL preserved
