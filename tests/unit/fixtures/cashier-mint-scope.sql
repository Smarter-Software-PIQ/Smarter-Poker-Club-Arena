-- Minimal relations for exercising the actual diamond debit, ledger declaration,
-- mint writer, bridge-rate reader and union-admission predicates in PostgreSQL.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;

CREATE TABLE profiles(id uuid PRIMARY KEY, diamonds integer, diamond_balance integer, is_horse boolean, updated_at timestamptz);
CREATE TABLE clubs(id uuid PRIMARY KEY, name text, owner_id uuid, union_id uuid, is_union boolean,
                   chip_treasury numeric DEFAULT 0, promo_balance numeric DEFAULT 0, updated_at timestamptz);
CREATE TABLE unions(id uuid PRIMARY KEY, owner_id uuid);
CREATE TABLE union_admins(union_id uuid REFERENCES unions, user_id uuid);
CREATE TABLE union_clubs(club_id uuid PRIMARY KEY REFERENCES clubs, union_id uuid REFERENCES unions);
CREATE TABLE club_members(club_id uuid REFERENCES clubs, user_id uuid, role text, status text, is_bot boolean,
                          chip_balance numeric, held_chips numeric, locked_chips numeric, promo_balance numeric);
CREATE TABLE union_wallets(union_id uuid PRIMARY KEY REFERENCES unions, chip_balance numeric, updated_at timestamptz);
CREATE TABLE agents(club_id uuid, business_balance numeric, player_balance numeric, promo_balance numeric);
CREATE TABLE tables(id uuid, club_id uuid);
CREATE TABLE table_seats(table_id uuid, left_at timestamptz, stack numeric);
CREATE TABLE bbj_pools(club_id uuid, union_id uuid, main_balance numeric, backup_balance numeric, promo_balance numeric);
CREATE TABLE ca_bridge_rate(id integer PRIMARY KEY, diamonds_per_chip integer);
INSERT INTO ca_bridge_rate VALUES (1,100);
CREATE TABLE chip_transactions(club_id uuid, from_user_id uuid, to_user_id uuid, amount numeric,
                               transaction_type text, notes text, metadata jsonb, balance_after numeric);
CREATE TABLE diamond_transactions(user_id uuid, amount integer, transaction_type text, type text, description text,
                                  balance_after integer, metadata jsonb, reference_id text, created_at timestamptz,
                                  counterparty text, issuance_class text);
CREATE TABLE chip_ledger(category text CONSTRAINT chip_ledger_category_check CHECK(category IN ('mint')),
                         from_type text CONSTRAINT chip_ledger_from_type_check CHECK(from_type IN ('issuance_reserve')),
                         destination text, entity uuid, amount numeric, idempotency_key text UNIQUE);
-- Capture what the real issuer declared at the moment the actual bank changed.
CREATE FUNCTION capture_fixture_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta numeric; target uuid;
BEGIN
  IF TG_TABLE_NAME = 'clubs' THEN
    delta := NEW.chip_treasury - OLD.chip_treasury;
    target := NEW.id;
  ELSE
    delta := NEW.chip_balance - COALESCE(OLD.chip_balance, 0);
    target := NEW.union_id;
  END IF;
  IF delta <> 0 THEN
    INSERT INTO chip_ledger VALUES(current_setting('app.ledger_category'), current_setting('app.ledger_counterparty'),
      TG_TABLE_NAME, target, delta, current_setting('app.ledger_idempotency_key'));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_club AFTER UPDATE OF chip_treasury ON clubs
 FOR EACH ROW EXECUTE FUNCTION capture_fixture_issuance();
CREATE TRIGGER capture_union AFTER INSERT OR UPDATE OF chip_balance ON union_wallets
 FOR EACH ROW EXECUTE FUNCTION capture_fixture_issuance();
