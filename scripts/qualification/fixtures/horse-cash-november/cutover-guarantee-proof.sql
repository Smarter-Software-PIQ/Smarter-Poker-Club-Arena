DO $proof$ BEGIN
 IF (SELECT guaranteed_prize=10000 AND name='Nightly 10K (NLH)' FROM tournaments WHERE id='00000000-0000-0000-0000-000000009001') IS DISTINCT FROM true THEN RAISE EXCEPTION 'nightly 10K not restored'; END IF;
 IF EXISTS(SELECT 1 FROM tournaments WHERE id IN ('00000000-0000-0000-0000-000000009002','00000000-0000-0000-0000-000000009003') AND (guaranteed_prize<>1500 OR name<>'1.5K GTD')) THEN RAISE EXCEPTION 'small guarantee not 1.5K'; END IF;
 IF EXISTS(SELECT 1 FROM tournaments t JOIN owner_before b USING(id) WHERE
   CASE WHEN b.guaranteed_prize IN(1200,1250) AND b.start_time >= '2026-11-02 06:00+00'::timestamptz AND NOT b.entry_contract_locked AND NOT b.prize_pool_finalized AND upper(b.status) IN('ANNOUNCED','REGISTERING') AND NOT EXISTS(SELECT 1 FROM tournament_players p WHERE p.tournament_id=b.id) THEN t.guaranteed_prize<>1500
   WHEN b.id='00000000-0000-0000-0000-000000009001' THEN t.guaranteed_prize<>10000
   ELSE to_jsonb(t) IS DISTINCT FROM to_jsonb(b) END) THEN RAISE EXCEPTION 'owner terms or unrelated original row changed'; END IF;
END $proof$;
