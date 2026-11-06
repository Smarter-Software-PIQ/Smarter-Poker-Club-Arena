ALTER SEQUENCE cutoff_reads RESTART WITH 1;
SELECT count(*) FROM ca_club_member_fee_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4');
DO $$ BEGIN ASSERT (SELECT last_value FROM cutoff_reads)=1, 'roster cutoff must be read once'; END $$;
