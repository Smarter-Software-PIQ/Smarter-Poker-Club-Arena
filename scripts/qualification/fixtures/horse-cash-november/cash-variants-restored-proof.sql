-- Owner November 14 (19:07, 19:10 and 20:42 Chicago), migration 20261115032204:
-- short deck, pineapple and PLO8 cash admit Horses again inside the .50/1
-- ceiling, through the same installed seat trigger, in Club and Diamond cash.
-- Runs after the migration is installed; the helper defaults to now().
DO $proof$ DECLARE v text; target integer; horse uuid := lpad('1',32,'0')::uuid; t uuid; BEGIN
 FOREACH v IN ARRAY ARRAY['short_deck','pineapple','plo8'] LOOP
  FOREACH target IN ARRAY ARRAY[101,103] LOOP
   t := lpad(target::text,32,'0')::uuid;
   UPDATE table_seats SET left_at=now() WHERE user_id=horse AND left_at IS NULL;
   UPDATE tables SET game_variant=v,small_blind=.5,big_blind=1 WHERE id=t;
   INSERT INTO table_seats VALUES(horse,t,null,null,100);
   IF NOT EXISTS(SELECT 1 FROM table_seats WHERE user_id=horse AND table_id=t AND left_at IS NULL)
   THEN RAISE EXCEPTION 'restored variant seat not persisted: % / %',v,target; END IF;
   UPDATE table_seats SET stack=104 WHERE user_id=horse AND table_id=t AND left_at IS NULL;
   UPDATE table_seats SET left_at=now() WHERE user_id=horse AND left_at IS NULL;
   -- The stake ceiling still refuses every chair above .50/1.
   UPDATE tables SET small_blind=1,big_blind=2 WHERE id=t;
   BEGIN
    INSERT INTO table_seats VALUES(horse,t,null,null,100);
    RAISE EXCEPTION 'restored variant admitted a horse above .50/1: % / %',v,target;
   EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'horse_cash_game_restricted:%' THEN RAISE; END IF;
   END;
   UPDATE tables SET small_blind=.5,big_blind=1.01 WHERE id=t;
   BEGIN
    INSERT INTO table_seats VALUES(horse,t,null,null,100);
    RAISE EXCEPTION 'restored variant admitted a horse above a 1 big blind: % / %',v,target;
   EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'horse_cash_game_restricted:%' THEN RAISE; END IF;
   END;
  END LOOP;
 END LOOP;
 -- Every other variant keeps its own ceiling at the same trigger.
 UPDATE tables SET game_variant='plo5',small_blind=2,big_blind=5 WHERE id=lpad('101',32,'0')::uuid;
 BEGIN
  INSERT INTO table_seats VALUES(horse,lpad('101',32,'0')::uuid,null,null,100);
  RAISE EXCEPTION 'standard ceiling lost after the restore';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE 'horse_cash_game_restricted:%' THEN RAISE; END IF;
 END;
END $proof$;
-- Humans at any stake and tournament seats are unchanged by the restore.
UPDATE tables SET game_variant='plo8',small_blind=1,big_blind=2 WHERE id=lpad('101',32,'0')::uuid;
INSERT INTO table_seats VALUES(lpad('91',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
UPDATE tables SET game_variant='short_deck',small_blind=2,big_blind=5 WHERE id=lpad('102',32,'0')::uuid;
INSERT INTO table_seats VALUES(lpad('3',32,'0')::uuid,lpad('102',32,'0')::uuid,null,null,100);
-- At the ceiling the restored variant seats a Horse normally; the ACL is unchanged.
UPDATE tables SET game_variant='pineapple',small_blind=.5,big_blind=1 WHERE id=lpad('101',32,'0')::uuid;
INSERT INTO table_seats VALUES(lpad('1',32,'0')::uuid,lpad('101',32,'0')::uuid,null,null,100);
DO $acl$ BEGIN
 IF has_function_privilege('anon','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 OR has_function_privilege('authenticated','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 OR NOT has_function_privilege('service_role','fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'restored helper ACL changed'; END IF;
END $acl$;
