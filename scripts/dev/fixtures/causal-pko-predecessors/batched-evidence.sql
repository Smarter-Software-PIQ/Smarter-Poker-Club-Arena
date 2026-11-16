-- Independent old PL/pgSQL validator and predecessor are the semantic oracles.
-- Every case is synthetic and rolled back; the installed money callers are
-- separately exercised by full-native.py, including both real lock races.
BEGIN;
-- Deliberate isolated corruption only; catalog and rows roll back together.
ALTER TABLE tournament_knockout_candidates DROP CONSTRAINT tournament_knockout_candidates_stack_after_check;
ALTER TABLE tournament_knockout_candidates ALTER COLUMN created_at DROP NOT NULL;
DO $$
DECLARE label text;x jsonb;t uuid;a uuid;b uuid;c uuid;h uuid;k record;item record;
 old_scope jsonb;old_result jsonb;new_result jsonb;n integer:=0;
BEGIN
 FOREACH label IN ARRAY ARRAY['valid','candidate_stack','candidate_identity','atomic_missing',
 'atomic_identity','atomic_written_shape','settlement_id','settlement_missing','settlement_state',
 'settlement_map','written_key','written_negative','written_exponent','written_null','written_long',
 'zero_missing','zero_conflict','history_missing','history_time','history_shape','empty_roster',
 'duplicate_roster','roster_missing_uid','roster_bad_uid','roster_missing_stack','roster_exponent',
 'roster_negative','roster_long','roster_stack_conflict','roster_incomplete','equivalent_numeric',
 'snake_case_uid','conflicting_narrative','uppercase_history','uppercase_written',
 'uppercase_both','case_distinct_roster','null_uid','null_stack','nan_stack','maximum_stack'] LOOP
  x:=fixture_chain();t:=(x->>'t')::uuid;a:=(x->>'a')::uuid;b:=(x->>'b')::uuid;c:=(x->>'c')::uuid;
  SELECT hand_id INTO h FROM tournament_knockout_candidates WHERE tournament_id=t AND eliminated_user_id=a;
  CASE label
   WHEN 'candidate_stack' THEN UPDATE tournament_knockout_candidates SET stack_after=1 WHERE hand_id=h;
   WHEN 'candidate_identity' THEN UPDATE tournament_knockout_candidates SET created_at=NULL WHERE hand_id=h;
   WHEN 'atomic_missing' THEN DELETE FROM hand_atomic_commits WHERE hand_id=h;
   WHEN 'atomic_identity' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{table_id}','"bad"') WHERE hand_id=h;
   WHEN 'atomic_written_shape' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written}','[]') WHERE hand_id=h;
   WHEN 'settlement_id' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{hand_id}','"bad"') WHERE hand_id=h;
   WHEN 'settlement_missing' THEN DELETE FROM settlement_idempotency_keys WHERE hand_id=h;
   WHEN 'settlement_state' THEN UPDATE settlement_idempotency_keys SET status='pending' WHERE hand_id=h;
   WHEN 'settlement_map' THEN UPDATE settlement_idempotency_keys SET result=jsonb_set(result,ARRAY['written',b::text],'99') WHERE hand_id=h;
   WHEN 'written_key' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written}',(stack_result->'written')||'{"bad":1}') WHERE hand_id=h;
   WHEN 'written_negative' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,ARRAY['written',b::text],'-1') WHERE hand_id=h;
   WHEN 'written_exponent' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,ARRAY['written',b::text],'"1e3"') WHERE hand_id=h;
   WHEN 'written_null' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,ARRAY['written',b::text],'null') WHERE hand_id=h;
   WHEN 'written_long' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,ARRAY['written',b::text],to_jsonb(repeat('1',33))) WHERE hand_id=h;
   WHEN 'zero_missing' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written}',(stack_result->'written')-a::text) WHERE hand_id=h;
   WHEN 'zero_conflict' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,ARRAY['written',a::text],'1') WHERE hand_id=h;
   WHEN 'history_missing' THEN DELETE FROM hand_history WHERE id=h;
   WHEN 'history_time' THEN UPDATE hand_history SET created_at='2000-01-01' WHERE id=h;
   WHEN 'history_shape' THEN UPDATE hand_history SET players='{}' WHERE id=h;
   WHEN 'empty_roster' THEN UPDATE hand_history SET players='[]' WHERE id=h;
   WHEN 'duplicate_roster' THEN UPDATE hand_history SET players=players||jsonb_build_array(players->0) WHERE id=h;
   WHEN 'roster_missing_uid' THEN UPDATE hand_history SET players=jsonb_set(players,'{0}',(players->0)-'userId'-'user_id') WHERE id=h;
   WHEN 'roster_bad_uid' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,userId}','"bad"') WHERE id=h;
   WHEN 'roster_missing_stack' THEN UPDATE hand_history SET players=jsonb_set(players,'{0}',(players->0)-'stack') WHERE id=h;
   WHEN 'roster_exponent' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}','"0e0"') WHERE id=h;
   WHEN 'roster_negative' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}','-1') WHERE id=h;
   WHEN 'roster_long' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}',to_jsonb(repeat('0',33))) WHERE id=h;
   WHEN 'roster_stack_conflict' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}','1') WHERE id=h;
   WHEN 'roster_incomplete' THEN UPDATE hand_history SET players=jsonb_build_array(players->0) WHERE id=h;
   WHEN 'equivalent_numeric' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}','"00.00"') WHERE id=h;
   WHEN 'snake_case_uid' THEN UPDATE hand_history SET players=jsonb_set(players,'{0}',((players->0)-'userId')||jsonb_build_object('user_id',a)) WHERE id=h;
   WHEN 'uppercase_history' THEN UPDATE hand_history SET players=jsonb_set(players,'{1,userId}',to_jsonb(upper(b::text))) WHERE id=h;
   WHEN 'uppercase_written' THEN UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written}',((stack_result->'written')-b::text)||jsonb_build_object(upper(b::text),stack_result->'written'->b::text)) WHERE hand_id=h;
   WHEN 'uppercase_both' THEN
    UPDATE hand_history SET players=jsonb_set(players,'{1,userId}',to_jsonb(upper(b::text))) WHERE id=h;
    UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written}',((stack_result->'written')-b::text)||jsonb_build_object(upper(b::text),stack_result->'written'->b::text)) WHERE hand_id=h;
   WHEN 'case_distinct_roster' THEN
    UPDATE hand_history SET players=players||jsonb_build_array(jsonb_set(players->1,'{userId}',to_jsonb(upper(b::text)))) WHERE id=h;
    UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,'{written}',(stack_result->'written')||jsonb_build_object(upper(b::text),stack_result->'written'->b::text)) WHERE hand_id=h;
   WHEN 'null_uid' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,userId}','null') WHERE id=h;
   WHEN 'null_stack' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}','null') WHERE id=h;
   WHEN 'nan_stack' THEN UPDATE hand_history SET players=jsonb_set(players,'{0,stack}','"NaN"') WHERE id=h;
   WHEN 'maximum_stack' THEN
    UPDATE hand_history SET players=jsonb_set(players,'{1,stack}',to_jsonb(repeat('9',32))) WHERE id=h;
    UPDATE hand_atomic_commits SET stack_result=jsonb_set(stack_result,ARRAY['written',b::text],to_jsonb(repeat('9',32))) WHERE hand_id=h;
   WHEN 'conflicting_narrative' THEN UPDATE hand_history SET winners=winners||jsonb_build_array(jsonb_build_object('deep',jsonb_build_array(c))) WHERE id=h;
   ELSE NULL;
  END CASE;
  IF label IN ('written_key','written_negative','written_exponent','written_null','written_long','zero_missing','zero_conflict','uppercase_written','uppercase_both','case_distinct_roster','maximum_stack') THEN
   UPDATE settlement_idempotency_keys s SET result=jsonb_set(result,'{written}',a.stack_result->'written') FROM hand_atomic_commits a WHERE a.hand_id=h AND s.hand_id=h;
  END IF;
  FOR item IN SELECT * FROM fn_pko_predecessor_accepted_scopes_v1(t,c) LOOP
   old_scope:=fn_pko_candidate_accepted_scope_v1(t,(item.candidate).id);
   PERFORM fixture_assert(old_scope IS NOT DISTINCT FROM item.scope,'joined scope equals original: '||label);n:=n+1;
  END LOOP;
  SELECT * INTO k FROM tournament_knockout_candidates WHERE tournament_id=t AND eliminated_user_id=b;
  old_result:=pg_temp.fixture_original_predecessor(t,b,k.table_id,k.hand_id,k.hand_number,k.seat_joined_at);
  new_result:=fn_pko_claim_predecessor_status_v1(t,b,k.table_id,k.hand_id,k.hand_number,k.seat_joined_at);
  PERFORM fixture_assert(old_result IS NOT DISTINCT FROM new_result,'complete predecessor verdict equals original: '||label);
 END LOOP;
 RAISE NOTICE 'BATCH_DIFFERENTIAL_PASS cases=41 candidate_scopes=%',n;
END $$;
ROLLBACK;
