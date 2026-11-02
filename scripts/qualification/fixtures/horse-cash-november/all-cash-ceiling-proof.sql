DO $proof$ DECLARE v text; target integer; BEGIN
 IF EXISTS ((SELECT * FROM tables EXCEPT SELECT * FROM original_ceiling_tables)
   UNION ALL (SELECT * FROM original_ceiling_tables EXCEPT SELECT * FROM tables))
 THEN RAISE EXCEPTION 'horse restriction changed human table configuration'; END IF;
 FOREACH v IN ARRAY ARRAY['plo4','plo5','plo6','nlh','flh','flo8','stud','unknown'] LOOP
  IF NOT fn_horse_cash_game_allowed(v,.5,1,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,1,2,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,2,5,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,.5,null,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,null,1,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,'NaN',1,null,'2026-11-02 06:00+00')
   OR fn_horse_cash_game_allowed(v,.5,'Infinity',null,'2026-11-02 06:00+00')
   OR NOT fn_horse_cash_game_allowed(v,2,5,null,'2026-11-02 05:59:59.999+00')
   OR NOT fn_horse_cash_game_allowed(v,2,5,lpad('1001',32,'0')::uuid,'2026-11-02 06:00+00')
  THEN RAISE EXCEPTION 'all-cash ceiling/boundary/tournament preservation failed: %',v; END IF;
  UPDATE tables SET game_variant=v,small_blind=1,big_blind=2;
  FOREACH target IN ARRAY ARRAY[101,103] LOOP
   BEGIN
    INSERT INTO table_seats VALUES(lpad('1',32,'0')::uuid,lpad(target::text,32,'0')::uuid,null,null,100);
    RAISE EXCEPTION 'high stakes horse admitted: % / %',v,target;
   EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'horse_cash_game_restricted:%' THEN RAISE; END IF;
   END;
  END LOOP;
 END LOOP;
 FOREACH v IN ARRAY ARRAY['pineapple','crazy_pineapple','short_deck','shortdeck','6+','plo8'] LOOP
  IF fn_horse_cash_game_allowed(v,.25,.5,null,'2026-11-02 06:00+00')
  THEN RAISE EXCEPTION 'prohibited variant became eligible: %',v; END IF;
 END LOOP;
 IF has_function_privilege('anon','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 OR has_function_privilege('authenticated','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 OR NOT has_function_privilege('service_role','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'all-cash helper ACL changed'; END IF;
END $proof$;
-- Same installed seat trigger: high-stakes humans and tournaments still enter;
-- existing stacks settle and horses can leave. No direct production probes.
INSERT INTO profiles VALUES(lpad('91',32,'0')::uuid,false,'active',null);
INSERT INTO table_seats VALUES(lpad('91',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
INSERT INTO table_seats VALUES(lpad('2',32,'0')::uuid,lpad('102',32,'0')::uuid,null,null,100);
UPDATE table_seats SET stack=106 WHERE user_id=lpad('1',32,'0')::uuid;
UPDATE table_seats SET left_at=now() WHERE user_id=lpad('1',32,'0')::uuid;
-- At the ceiling an eligible horse still enters normally.
UPDATE tables SET game_variant='nlh',small_blind=.5,big_blind=1;
INSERT INTO table_seats VALUES(lpad('1',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
