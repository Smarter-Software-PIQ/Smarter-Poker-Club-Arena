-- Backup Engine placeholder accounts. Seeded platform rows reference real
-- accounts (club owners, agents, operators) whose data is never copied. Each
-- referenced id gets an id-only placeholder so foreign keys hold; no name,
-- email, phone or balance of any real person exists in the Backup Engine.
BEGIN;
CREATE TEMP TABLE _ref(id uuid PRIMARY KEY) ON COMMIT DROP;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, a.attname
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class rc ON rc.oid = k.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1
       AND ((rn.nspname = 'public' AND rc.relname = 'profiles') OR (rn.nspname = 'auth' AND rc.relname = 'users'))
       AND n.nspname IN ('public','smarter_private','ops')
       AND c.reltuples <> 0
  LOOP
    EXECUTE format('INSERT INTO _ref SELECT DISTINCT %I FROM %I.%I WHERE %I IS NOT NULL ON CONFLICT DO NOTHING',
                   r.attname, r.nspname, r.relname, r.attname);
  END LOOP;
END $$;
-- Clubs, unions and wallets name their owners without a foreign key.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_schema, table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type = 'uuid'
              AND column_name ~ '^(owner_id|user_id|agent_id|created_by|performed_by|co_owner_id|admin_id)$'
              AND table_name IN ('clubs','unions','union_clubs','club_members','club_wallets','union_wallets','agents','tables','cash_games')
  LOOP
    EXECUTE format('INSERT INTO _ref SELECT DISTINCT %I FROM %I.%I WHERE %I IS NOT NULL ON CONFLICT DO NOTHING',
                   r.column_name, r.table_schema, r.table_name, r.column_name);
  END LOOP;
END $$;
INSERT INTO auth.users (id, instance_id, aud, role)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated' FROM _ref
ON CONFLICT (id) DO NOTHING;
CREATE TEMP TABLE _placeholder_trigger_modes ON COMMIT DROP AS
WITH RECURSIVE relations(oid) AS (
  SELECT 'public.profiles'::regclass::oid
  UNION ALL SELECT i.inhrelid FROM pg_inherits i JOIN relations r ON i.inhparent=r.oid
)
SELECT t.tgrelid,t.tgname,t.tgenabled FROM pg_trigger t JOIN relations r ON r.oid=t.tgrelid
 WHERE NOT t.tgisinternal;
ALTER TABLE public.profiles DISABLE TRIGGER USER;
INSERT INTO public.profiles (id, display_name, is_horse)
SELECT id, 'Backup placeholder', false FROM _ref ON CONFLICT (id) DO NOTHING;
SELECT format('ALTER TABLE ONLY %s %s TRIGGER %I',tgrelid::regclass,
 CASE tgenabled WHEN 'D' THEN 'DISABLE' WHEN 'O' THEN 'ENABLE'
                WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' END,tgname)
 FROM _placeholder_trigger_modes ORDER BY tgrelid,tgname \gexec
SELECT count(*) AS placeholder_candidates FROM _ref;
COMMIT;
