UPDATE tournaments t SET guaranteed_prize=b.before FROM delayed_expected b WHERE t.id=b.id;
INSERT INTO tournament_players VALUES ('b84fcc96-cf94-4b94-a76b-329d80a7f555');
UPDATE tournaments SET entry_contract_locked=true WHERE id='ce952f30-825a-4080-acd0-aa83a4503855';
UPDATE tournaments SET prize_pool_finalized=true WHERE id='5435baf9-b626-4a94-8282-e927f02fc30a';
UPDATE tournaments SET status='RUNNING' WHERE id='aaf3a0ac-81ba-4b68-8d2d-a9ae75095f72';
UPDATE tournaments SET start_time='2026-11-02 05:59:59+00' WHERE id='930eee14-faaf-43cf-8f4a-bd8a92c48fd6';
UPDATE tournaments SET created_at='2026-11-02 05:59:59+00' WHERE id='2e51996a-a226-4b0d-8def-4931aa9d4a9c';
UPDATE tournaments SET schedule_id=NULL WHERE id='4b07b775-26d9-471d-bfd0-fd3f3e86817a';
CREATE TEMP TABLE delayed_protected_before AS SELECT * FROM tournaments;
