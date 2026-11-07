DO $test$
DECLARE clubs uuid[]; a date; b date; delta bigint;
BEGIN
 FOR clubs IN SELECT x FROM (VALUES
 (ARRAY['a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid]),
 (ARRAY['2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid]),
 (ARRAY['a0000000-0000-0000-0000-000000000001'::uuid]),
 (ARRAY['a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,'2a1132b9-5ba2-42e6-9f01-30a7fcffebe3','a0000000-0000-0000-0000-000000000001']),
 (ARRAY[]::uuid[]), (NULL::uuid[]))v(x) LOOP
  FOR a,b IN SELECT * FROM (VALUES(CURRENT_DATE-13,CURRENT_DATE),(CURRENT_DATE-27,CURRENT_DATE-14),(CURRENT_DATE-90,CURRENT_DATE-89))w(a,b) LOOP
   SELECT count(*) INTO delta FROM (
    (SELECT * FROM ca_stats_club_data_fact_ct WHERE club_id=ANY(clubs) AND stat_date BETWEEN a AND b
     EXCEPT ALL SELECT * FROM fn_ca_club_data_fact_window(clubs,a,b))
    UNION ALL
    (SELECT * FROM fn_ca_club_data_fact_window(clubs,a,b)
     EXCEPT ALL SELECT * FROM ca_stats_club_data_fact_ct WHERE club_id=ANY(clubs) AND stat_date BETWEEN a AND b)
   )diff;
   IF delta<>0 THEN RAISE EXCEPTION 'window projection mismatch % % %',clubs,a,b; END IF;
  END LOOP;
 END LOOP;
 -- Two distinct raw source clubs must survive under the one projected club,
 -- including the projection's existing retired-assigned second branch.
 IF (SELECT sum(fee) FROM fn_ca_club_data_fact_window(ARRAY['2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid],CURRENT_DATE,CURRENT_DATE)
      WHERE user_id='70000000-0000-0000-0000-000000000001')<>7 THEN
  RAISE EXCEPTION 'source identities collapsed during attribution';
 END IF;
END $test$;
