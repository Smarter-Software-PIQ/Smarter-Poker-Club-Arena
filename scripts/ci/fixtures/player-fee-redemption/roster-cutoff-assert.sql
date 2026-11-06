DO $$
DECLARE boundary timestamptz; from_day date; target uuid; c uuid;
BEGIN
 FOREACH boundary IN ARRAY ARRAY[NULL::timestamptz,'2026-10-25 00:00Z'::timestamptz,'infinity'::timestamptz] LOOP
  UPDATE fixture_cutoff SET value=boundary;
  FOREACH c IN ARRAY ARRAY['a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,'99999999-9999-9999-9999-999999999999'::uuid] LOOP
   FOREACH from_day IN ARRAY ARRAY[NULL::date,'2026-10-25'::date,'2026-10-26'::date] LOOP
    FOREACH target IN ARRAY ARRAY[NULL::uuid,'69f2cefa-017d-49f3-ac3e-61505633747c'::uuid,'47965354-0e56-43ef-931c-ddaab82af765'::uuid] LOOP
     ASSERT NOT EXISTS(
      (SELECT * FROM ca_club_member_fee_totals(c,from_day,from_day,target) EXCEPT ALL SELECT * FROM fixture_old_fee_totals(c,from_day,from_day,target))
      UNION ALL
      (SELECT * FROM fixture_old_fee_totals(c,from_day,from_day,target) EXCEPT ALL SELECT * FROM ca_club_member_fee_totals(c,from_day,from_day,target))
     ),'launch/date/player/club output changed';
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 ASSERT NOT has_function_privilege('anon','ca_club_member_fee_totals(uuid,date,date,uuid)','EXECUTE');
 ASSERT (SELECT provolatile='s' AND NOT prosecdef FROM pg_proc WHERE oid='ca_club_member_fee_totals(uuid,date,date,uuid)'::regprocedure);
END $$;
\echo PASS: original/new exact multiset equality for 54 launch/date/player/club combinations, missing/nonfinite receipts, rounding, tournament shares and ACL.
