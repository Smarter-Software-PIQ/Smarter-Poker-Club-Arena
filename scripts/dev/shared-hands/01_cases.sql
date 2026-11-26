-- Every door of 20261107021555 and 20261126054024, as the role that really
-- calls it. Opening a link reads; counting a view is its own signed-in door.
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
SELECT pg_temp.check('a preview crawler opens it', (fn_ca_shared_hand_open(:'tok', false) ->> 'found')::boolean);
DO $$ BEGIN PERFORM fn_ca_shared_hand_count_view('AbCd2345'); RAISE NOTICE 'FAIL anon cannot count a view';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon cannot count a view'; END $$;
RESET ROLE;
SELECT pg_temp.check('a signed-out open writes nothing', (SELECT view_count = 0 AND last_viewed_at IS NULL FROM ca_shared_hands WHERE token = :'tok'));
SELECT pg_temp.check('the anon door is STABLE and its body never writes',
  (SELECT provolatile = 's' AND pg_get_functiondef(oid) !~* '(^|[^a-z_])(insert into|update |delete from)'
     FROM pg_proc WHERE oid = 'fn_ca_shared_hand_open(text,boolean)'::regprocedure));
SELECT pg_temp.check('no shared-hand writer is executable by anon',
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\_ca\_shared\_hand\_%' AND prosecdef
     AND has_function_privilege('anon', oid, 'EXECUTE')
     AND pg_get_functiondef(oid) ~* '(^|[^a-z_])(insert into|update |delete from)'));
SELECT pg_temp.check('the public reader is recorded where the telemetry sweep reads it',
  EXISTS (SELECT 1 FROM ca_browser_definer_allowlist WHERE proname = 'fn_ca_shared_hand_open'));

SET ROLE authenticated; SELECT pg_temp.as_user('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.check('the sender opening their own link', (fn_ca_shared_hand_open(:'tok') ->> 'found')::boolean);
SELECT pg_temp.check('the sender''s own open is not a view', NOT (fn_ca_shared_hand_count_view(:'tok') ->> 'counted')::boolean);
SELECT pg_temp.check('mark sent', (fn_ca_shared_hand_mark_sent(:'tok') ->> 'success')::boolean);
SELECT pg_temp.as_user('22222222-2222-2222-2222-222222222222');
SELECT pg_temp.check('another player cannot revoke it', NOT (fn_ca_shared_hand_revoke(:'tok') ->> 'success')::boolean);
SELECT pg_temp.check('another player cannot mark it sent', NOT (fn_ca_shared_hand_mark_sent(:'tok') ->> 'success')::boolean);
SELECT pg_temp.check('another player opens it', (fn_ca_shared_hand_open(:'tok') ->> 'found')::boolean);
SELECT pg_temp.check('another signed-in player counts a view', (fn_ca_shared_hand_count_view(:'tok') ->> 'counted')::boolean);
SELECT pg_temp.check('a malformed token counts nothing', NOT (fn_ca_shared_hand_count_view('../../etc') ->> 'counted')::boolean);
SELECT pg_temp.as_user('');
DO $$ BEGIN PERFORM fn_ca_shared_hand_count_view('AbCd2345'); RAISE NOTICE 'FAIL a session with no account is refused';
EXCEPTION WHEN invalid_authorization_specification THEN RAISE NOTICE 'PASS a session with no account is refused'; END $$;
RESET ROLE;
SELECT pg_temp.check('the sender is not counted; the other player is', (SELECT view_count = 1 AND last_viewed_at IS NOT NULL FROM ca_shared_hands WHERE token = :'tok'));
SELECT pg_temp.check('sent is recorded', (SELECT sent_at IS NOT NULL FROM ca_shared_hands WHERE token = :'tok'));

SET ROLE authenticated; SELECT pg_temp.as_user('11111111-1111-1111-1111-111111111111');
SELECT pg_temp.check('the sender revokes', (fn_ca_shared_hand_revoke(:'tok') ->> 'success')::boolean);
SELECT pg_temp.check('a revoked link carries no hand', fn_ca_shared_hand_open(:'tok') = '{"found": true, "revoked": true}'::jsonb);
SELECT fn_ca_shared_hand_reserve(:'payload') ->> 'token' AS tok2 \gset
SELECT pg_temp.check('sharing again makes a new token', :'tok2' <> :'tok');
SELECT pg_temp.as_user('22222222-2222-2222-2222-222222222222');
SELECT pg_temp.check('a revoked link counts no view', NOT (fn_ca_shared_hand_count_view(:'tok') ->> 'counted')::boolean);
RESET ROLE;
SET ROLE service_role; SELECT pg_temp.as_user(''); SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.check('the server (service_role) can count a signed-out visit', (fn_ca_shared_hand_count_view(:'tok2') ->> 'counted')::boolean);
SELECT set_config('request.jwt.claim.role', '', false);
RESET ROLE;
SELECT pg_temp.check('the revoked link kept its count', (SELECT view_count FROM ca_shared_hands WHERE token = :'tok') = 1);

INSERT INTO ca_shared_hands (token, sender_id, payload, payload_md5)
  VALUES ('Zz23Zz23', '33333333-3333-3333-3333-333333333333', :'payload', md5('deleted'));
SET ROLE anon;
SELECT pg_temp.check('a deleted sender''s link opens nothing', fn_ca_shared_hand_open('Zz23Zz23') = '{"found": false}'::jsonb);
SELECT pg_temp.check('a malformed token opens nothing', fn_ca_shared_hand_open('../../etc') = '{"found": false}'::jsonb);
RESET ROLE;
SET ROLE authenticated; SELECT pg_temp.as_user('22222222-2222-2222-2222-222222222222');
SELECT pg_temp.check('a deleted sender''s link counts no view', NOT (fn_ca_shared_hand_count_view('Zz23Zz23') ->> 'counted')::boolean);
RESET ROLE;

-- The short-link store transports the browser's recording opaquely. It only
-- admits a larger payload inside the versioned hand's presentation field.
SELECT translate(rtrim(replace(encode(convert_to('v4' || repeat('~x',20) ||
  '~3o.' || repeat('abcd', 1900),'UTF8'),'base64'), E'\n',''),'='),'+/','-_') AS captured \gset
SET ROLE authenticated; SELECT pg_temp.as_user('11111111-1111-1111-1111-111111111111');
SELECT fn_ca_shared_hand_reserve(:'captured') ->> 'token' AS recorded_token \gset
SELECT pg_temp.check('a long recording receives a short token', length(:'recorded_token') = 8);
SELECT pg_temp.check('unstructured large payload is refused', fn_ca_shared_hand_reserve(repeat('a',12000)) ->> 'code' = 'bad_payload');
RESET ROLE;
SET ROLE anon; SELECT pg_temp.as_user('');
SELECT pg_temp.check('signed-out replay retrieves the complete recording', fn_ca_shared_hand_open(:'recorded_token',false) ->> 'payload' = :'captured');
RESET ROLE;
