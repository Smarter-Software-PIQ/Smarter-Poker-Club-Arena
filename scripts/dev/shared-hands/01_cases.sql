-- Every door of 20261107021555, as the role that really calls it.
\set payload 'djR-TkxIfjAuMjUtMC41fjZ-bXc1ZWI3MHB-MTpUVzl1WjI4'
CREATE FUNCTION pg_temp.check(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN RAISE NOTICE '% %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, name; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', uid, false) $$;

SET ROLE authenticated; SELECT pg_temp.as_user('11111111-1111-1111-1111-111111111111');
SELECT fn_ca_shared_hand_reserve(:'payload', 'hstaaaa',
  '{"handNumber":"56019216","pot":"3.43","board":"9h Jh 3c Ah 6s","senderName":"Mongo","evil":"x"}') ->> 'token' AS tok \gset
SELECT pg_temp.check('reserve returns an 8-character token', :'tok' ~ '^[A-HJ-NP-Za-km-z2-9]{8}$');
SELECT pg_temp.check('the same hand reuses its token', fn_ca_shared_hand_reserve(:'payload') ->> 'token' = :'tok');
SELECT pg_temp.check('a payload outside the link alphabet is refused', fn_ca_shared_hand_reserve('<script>alert(1)</script>') ->> 'code' = 'bad_payload');
SELECT pg_temp.check('a payload longer than 255 characters is accepted', (fn_ca_shared_hand_reserve(repeat('A', 600)) ->> 'success')::boolean);
RESET ROLE;
SELECT pg_temp.check('the invite code is kept upper-case', (SELECT invite_code FROM ca_shared_hands WHERE token = :'tok') = 'HSTAAAA');
SELECT pg_temp.check('unknown preview keys are dropped', (SELECT NOT (preview ? 'evil') AND preview ->> 'senderName' = 'Mongo' FROM ca_shared_hands WHERE token = :'tok'));

SET ROLE anon; SELECT pg_temp.as_user('');
DO $$ BEGIN PERFORM 1 FROM ca_shared_hands; RAISE NOTICE 'FAIL anon cannot read the table';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon cannot read the table'; END $$;
DO $$ BEGIN PERFORM fn_ca_shared_hand_reserve('djR-TkxIfjAuMjUtMC41fjZ-bXc1ZWI3MHB-MTpUVzl1WjI4'); RAISE NOTICE 'FAIL anon cannot reserve';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon cannot reserve'; END $$;
SELECT pg_temp.check('a signed-out viewer opens the hand', fn_ca_shared_hand_open(:'tok') ->> 'payload' = :'payload');
SELECT pg_temp.check('a preview crawler opens it without counting', (fn_ca_shared_hand_open(:'tok', false) ->> 'found')::boolean);
RESET ROLE;
SELECT pg_temp.check('one counted view', (SELECT view_count FROM ca_shared_hands WHERE token = :'tok') = 1);

SET ROLE authenticated; SELECT pg_temp.as_user('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.check('the sender opening their own link', (fn_ca_shared_hand_open(:'tok') ->> 'found')::boolean);
SELECT pg_temp.check('mark sent', (fn_ca_shared_hand_mark_sent(:'tok') ->> 'success')::boolean);
SELECT pg_temp.as_user('22222222-2222-2222-2222-222222222222');
SELECT pg_temp.check('another player cannot revoke it', NOT (fn_ca_shared_hand_revoke(:'tok') ->> 'success')::boolean);
SELECT pg_temp.check('another player cannot mark it sent', NOT (fn_ca_shared_hand_mark_sent(:'tok') ->> 'success')::boolean);
SELECT pg_temp.check('another player opens it', (fn_ca_shared_hand_open(:'tok') ->> 'found')::boolean);
RESET ROLE;
SELECT pg_temp.check('the sender is not counted; the other player is', (SELECT view_count FROM ca_shared_hands WHERE token = :'tok') = 2);
SELECT pg_temp.check('sent is recorded', (SELECT sent_at IS NOT NULL FROM ca_shared_hands WHERE token = :'tok'));

SET ROLE authenticated; SELECT pg_temp.as_user('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.check('the sender revokes', (fn_ca_shared_hand_revoke(:'tok') ->> 'success')::boolean);
SELECT pg_temp.check('a revoked link carries no hand', fn_ca_shared_hand_open(:'tok') = '{"found": true, "revoked": true}'::jsonb);
SELECT pg_temp.check('sharing again makes a new token', fn_ca_shared_hand_reserve(:'payload') ->> 'token' <> :'tok');
RESET ROLE;

INSERT INTO ca_shared_hands (token, sender_id, payload, payload_md5)
  VALUES ('Zz23Zz23', '33333333-3333-3333-3333-333333333333', :'payload', md5('deleted'));
SET ROLE anon;
SELECT pg_temp.check('a deleted sender''s link opens nothing', fn_ca_shared_hand_open('Zz23Zz23') = '{"found": false}'::jsonb);
SELECT pg_temp.check('a malformed token opens nothing', fn_ca_shared_hand_open('../../etc') = '{"found": false}'::jsonb);
RESET ROLE;
