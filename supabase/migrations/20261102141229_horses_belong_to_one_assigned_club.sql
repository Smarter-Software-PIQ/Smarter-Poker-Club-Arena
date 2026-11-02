-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- HORSES BELONG TO ONE ASSIGNED CLUB (owner order, 2026-11-02).
--
-- Dan, 2026-11-02: Deep Stack Society gets 500 horses, The Felt Society gets
-- 500, KINGS CLUB gets none; horses may no longer play in two clubs; every
-- chip a horse holds in a club it is not assigned to goes back to that club's
-- main bank; every horse restarts at exactly 10,000, the clubs funded from the
-- Mint only for a verified shortfall. Follow-up instruction the same day: the
-- split lives in authoritative source and schema with a fixed manifest, is
-- enforced at every admission door, runs as one idempotent audited operation
-- only after the week's rakeback has paid and under verified maintenance
-- conditions, never as an owner impersonation, and Kings Club's real counts
-- stay real (any display addition is labelled separately).
--
-- WHAT THIS MIGRATION DOES (no money moves here; nothing is enforced yet):
--
-- 1. THE MANIFEST. ca_horse_club_assignments holds exactly the 1,000 canonical
--    horses (ca_horse_fleet_register, retired_at IS NULL, as of 2026-11-02),
--    500 assigned to Deep Stack Society and 500 to The Felt Society. Rule,
--    recorded so it can be re-derived: a horse with a Felt membership and no
--    Deep Stack membership stays in Felt; every other horse goes to Deep Stack;
--    the 18 Felt-only horses with the lowest md5('horse-club-split-20261102:'
--    || id) move to Deep Stack so both clubs hold 500. The rows are literal;
--    the sha256 of the sorted "horse_id:D|F" lines is asserted below
--    (22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270).
--
-- 2. ENFORCEMENT, armed later by the operation (phase 'enforcing'). Three
--    existing trigger bodies are replaced with their exact preimages plus one
--    call each (no trigger DDL, no lock on a hot table):
--    - fn_ca_reject_automated_user_club_row (club_members, table_seats,
--      tournament_players): a horse may hold a membership only in its
--      assigned club, and may sit or enter only where the host is its
--      assigned club or a union that contains it. KINGS CLUB never admits a
--      horse. A horse with no assignment is admitted nowhere.
--    - fn_stamp_seat_club: after the stamp, a live horse seat must be funded
--      from the assigned club (rebuys, top-ups and union routing all charge
--      the seat's club).
--    - fn_guard_membership_lifecycle_write: a horse cannot rejoin a club it
--      is not assigned to.
--    While the operation runs (phase 'draining' / 'executing') every new horse
--    seat, entry, membership and rejoin is refused everywhere, so nothing can
--    move while chips are reconciled.
--
-- 3. THE OPERATION. fn_ca_horse_club_split_preflight() reports every blocker;
--    fn_ca_horse_club_split_begin_drain(op) arms the drain;
--    fn_ca_horse_club_split_execute(op, mint_cap) runs in resumable chunks and
--    refuses to move a chip unless: the 2026-10-26..2026-11-02 weekly payout
--    has released with nothing still owed, the fleet is disabled, and no horse
--    holds a live seat, a registered/playing tournament entry, a pending
--    cashout, escrow or an issued ticket. Each wallet move mirrors the
--    supported Club Bank claim/send journal exactly (declared ledger,
--    correlation, chip_transactions row keyed on a deterministic op id), so a
--    replay is refused by the existing unique indexes and recorded receipts.
--    Earned agent-wallet balances in a horse's assigned club are not touched;
--    agent wallets in a club the horse leaves are claimed into that club's
--    bank. Departures use the records-retained lifecycle (status suspended,
--    membership_lifecycle_status departed), never a DELETE.
--
-- 4. KINGS CLUB DISPLAY. Its blended +1,000 member boost goes to 0, so the
--    member and active counts it shows are real. The requested +1,500 / +233
--    are recorded separately in club_display_labeled_additions and served by
--    fn_club_display_labeled_additions(uuid[]) for the client to show as a
--    separately labelled figure, never added into the real counts.
--
-- 5. KINGS CLUB fleet policy: a club-scoped row with enabled = false and
--    pause_new_seatings = true, so the engine stops offering Kings seats.
--
-- No function the weekly payout or own-agent preparation owns is touched.
-- @live-proof: (SELECT count(*) FILTER (WHERE club_id='2a1132b9-5ba2-42e6-9f01-30a7fcffebe3')=500 AND count(*) FILTER (WHERE club_id='a0000000-0000-0000-0000-000000000001')=500 FROM public.ca_horse_club_assignments)
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_reject_automated_user_club_row()'::regprocedure))
    IS DISTINCT FROM '7c73094df30c90f94a78cbbd5d24f504' THEN RAISE EXCEPTION 'automated_club_guard_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_stamp_seat_club()'::regprocedure))
    IS DISTINCT FROM '467104f7e791b76328ce5e20b42ba81b' THEN RAISE EXCEPTION 'seat_stamp_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_guard_membership_lifecycle_write()'::regprocedure))
    IS DISTINCT FROM '9d41bf84bc77ef026c604438c0c96b5e' THEN RAISE EXCEPTION 'lifecycle_guard_preimage_changed'; END IF;
END
$guard$;

-- 1. THE MANIFEST ------------------------------------------------------------
-- No foreign keys: these are evidence tables beside hot tables (CLAUDE.md DDL rule 7).
CREATE TABLE public.ca_horse_club_manifests (
  version text PRIMARY KEY,
  manifest_sha256 text NOT NULL,
  deep_stack_count integer NOT NULL,
  felt_count integer NOT NULL,
  rule text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ca_horse_club_assignments (
  horse_id uuid PRIMARY KEY,
  club_id uuid NOT NULL CHECK (club_id IN ('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid,
                                           'a0000000-0000-0000-0000-000000000001'::uuid)),
  manifest_version text NOT NULL REFERENCES public.ca_horse_club_manifests(version),
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ca_horse_club_assignments_club_idx ON public.ca_horse_club_assignments(club_id);

CREATE TABLE public.ca_horse_club_split_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  phase text NOT NULL DEFAULT 'inactive'
    CHECK (phase IN ('inactive','draining','executing','enforcing')),
  operation_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ca_horse_club_split_state(singleton) VALUES (true);

CREATE TABLE public.ca_horse_club_split_operations (
  operation_id uuid PRIMARY KEY,
  manifest_version text NOT NULL REFERENCES public.ca_horse_club_manifests(version),
  operator_label text NOT NULL,
  mint_cap numeric(20,2) NOT NULL DEFAULT 0 CHECK (mint_cap >= 0),
  stage text NOT NULL DEFAULT 'draining'
    CHECK (stage IN ('draining','sweeping','minting','funding','enforcing','complete')),
  preflight jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb
);

CREATE TABLE public.ca_horse_club_split_receipts (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES public.ca_horse_club_split_operations(operation_id),
  horse_id uuid,
  club_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('player_wallet_claim','agent_wallet_claim','departed','joined',
                                     'downline_released','mint','fund_10000','kings_display')),
  amount numeric(20,2) NOT NULL DEFAULT 0,
  wallet_before numeric(20,2),
  wallet_after numeric(20,2),
  bank_before numeric(20,2),
  bank_after numeric(20,2),
  op_key uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (operation_id, horse_id, club_id, kind)
);

ALTER TABLE public.ca_horse_club_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_horse_club_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_horse_club_split_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_horse_club_split_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_horse_club_split_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_horse_club_manifests, public.ca_horse_club_assignments,
  public.ca_horse_club_split_state, public.ca_horse_club_split_operations,
  public.ca_horse_club_split_receipts FROM PUBLIC, anon, authenticated;

INSERT INTO public.ca_horse_club_manifests(version, manifest_sha256, deep_stack_count, felt_count, rule)
VALUES ('horse-club-split-20261102',
        '22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270', 500, 500,
        'Felt membership and no Deep Stack membership stays in Felt; every other canonical horse to Deep Stack; the 18 Felt-only horses with the lowest md5(''horse-club-split-20261102:''||id) move to Deep Stack.');

INSERT INTO public.ca_horse_club_assignments(horse_id, club_id, manifest_version)
SELECT v.h::uuid,
       CASE v.k WHEN 'D' THEN '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid
                ELSE 'a0000000-0000-0000-0000-000000000001'::uuid END,
       'horse-club-split-20261102'
  FROM (VALUES
('005428fe-a366-461f-a23d-ef08f837a94b','F'),
('005d5fd2-ae8c-4d21-bb55-f33592a88b31','D'),
('0097309f-2864-4d09-b02b-56bca012a9c3','F'),
('00bc0957-1913-4beb-a4d1-acab94950690','F'),
('00d92d99-be9f-4e63-8ab0-ec2d6d491bcc','F'),
('00f3f3a5-32f9-4efb-8ead-c5e681d22504','D'),
('01809c11-71bc-42a6-ad86-2130737d8cf9','F'),
('01bd8786-371e-4ba2-85d6-baab469bba07','D'),
('023a16c3-4ddb-427f-a9f8-cd7b1d9072f1','F'),
('02c8d806-24c7-40bd-b5b5-30cf96811e3e','D'),
('02f807c7-52a6-470b-a465-4a45b84a9143','F'),
('032b7ef6-ef40-4eb7-9a44-21605be733c8','F'),
('0335d503-5c71-48d7-aaf4-bc8c907adebb','F'),
('0362d601-667c-4301-b3a0-e371615a2bc3','D'),
('036f0b55-c601-4d09-982a-5294cf4ea15d','D'),
('03951af5-7cf1-4164-aaf0-571b647d98d5','D'),
('03980374-354e-4e65-8aa4-2f284e5e51ee','F'),
('0457e109-c9f4-477a-85c6-cd1e822e4885','D'),
('046718c5-474f-4108-a15c-c3a1ce1f8d61','F'),
('04910a99-8757-4581-8c84-12ba8a454a75','D'),
('049c89ca-8c3a-4ffa-9f68-38849f956f07','D'),
('05710b66-e9e0-42f7-a3e9-2841df4a598a','D'),
('05835920-da9b-4739-8fa2-2901b844d11d','D'),
('05a38e8e-ce5f-44fb-82de-782369bf9fab','D'),
('060c946d-db8d-4d27-b1ec-a203435764f1','D'),
('06c09311-deea-4402-a759-e188148757a0','F'),
('06eb013d-57d3-46ed-a069-b6a71df00d13','D'),
('06f16138-70cd-49e5-89b3-aec698118b81','D'),
('06f7b8ff-889c-4634-b7bb-7d6c010ad8a1','F'),
('07140eab-8afc-46b4-ad0e-e7f10a39cb10','F'),
('07534039-d056-45bb-adcd-1415ed6a8a08','F'),
('07db1c71-d567-46dd-8f92-e922b6d470ae','F'),
('083db75b-95a3-47ae-9989-927134dfa026','F'),
('085524dc-e663-4dad-abc5-8442450cc9f1','D'),
('0860d731-0d86-409a-8384-41a17b99a1f4','F'),
('08fdc13e-eedc-41f6-8790-a91515e14e4f','F'),
('096d7521-f924-461e-8c3d-5386a7770170','D'),
('097fccb7-2ec3-4eff-8050-36862a080e24','D'),
('09dd202d-115b-49ae-afa8-cb528c7b8f72','F'),
('09faf9f3-ed77-4582-9242-c464cb88fa93','D'),
('0a1e9f3a-87c2-4a4b-b386-3b88de4ed054','F'),
('0a558bc1-50c5-4201-b6ca-c7a1e7de1c22','D'),
('0a714eff-ef23-4928-b2a7-addecc97b467','F'),
('0a8005e8-5d79-4d8f-809e-e9951ef74651','D'),
('0a9625c9-f679-4d98-9ebe-d8bb005c45b6','F'),
('0b1a64c2-8970-4f89-a396-9863e3aa2ccc','D'),
('0b3887e1-5a5b-4f63-8967-53e9412c0609','D'),
('0b7b31ad-abb6-486d-98be-4af51bd90a02','F'),
('0bb5a13b-e7e5-4f87-ad4c-d102b4f4f61e','F'),
('0bbffcd1-c33c-4832-868e-33a26a409a68','D'),
('0bea449d-73af-4654-bf19-61db087d7d45','D'),
('0c7ad36f-7ad2-4faa-963f-69ee2f9f5062','F'),
('0ce13c54-930f-48b5-93a9-df7a38e90b7f','D'),
('0d766e23-bdf2-437a-87f4-0268605c8120','F'),
('0d8a22d1-8ea8-40d7-a821-10547198ff6c','F'),
('0d94b1d9-c7a6-472f-94c7-8728718c92f8','D'),
('0dd67dd0-12b4-4f2c-85fc-c85a702fff2e','D'),
('0ea03648-b12d-4ae7-ba65-aeaff4fcea34','F'),
('0f14f372-0c43-47ff-9257-1324a7e94488','F'),
('0f40b50c-8ce5-41ec-9537-b58b12385937','D'),
('0f5f1d65-7ce1-4250-93fe-49078f4f14d1','F'),
('0fb78895-f4e0-4759-9403-a49a5612e0b5','F'),
('0fdb265e-7a56-4ecf-8410-eecd49923e42','D'),
('1000eabd-a6a4-4bdc-acfc-11019ce61b0c','F'),
('10d08b4f-f6da-41ea-a66c-e97a0d4930e0','F'),
('10f7c3e0-b291-4039-a157-42e5609fe531','D'),
('1110a1ed-fcf2-423b-9d9a-bc615a16cbd5','F'),
('113fc1bc-25f5-4508-8244-2aa3aa04a3cf','F'),
('11758a4f-55bc-4758-861a-bee6830c70b8','D'),
('1179f15e-dac7-4b7e-80df-5e525a498ddd','D'),
('119d8e7f-1b09-4299-810e-89dc9a6a6277','D'),
('11d2e4ff-a1f7-4845-bb96-a0626eee0d57','D'),
('127bff9a-8483-4018-80ac-21d7f76ce5c7','D'),
('128ad0d0-33bd-4c46-8c8d-ddd63ed98639','D'),
('13133bc4-9139-4066-8b55-8edd31ef2318','D'),
('137ca64e-eb2a-48a1-84ad-1db2b59aa51e','D'),
('13a93a1f-b773-43ac-89a7-d21aef6bb8f1','D'),
('13f916ec-9dc1-4e8e-bd29-dc7e883c5a77','F'),
('145aaccb-b8bf-434a-b5e7-ca23a306799c','F'),
('146cf7a5-7f99-4dd3-858d-26dae69d9c80','F'),
('1486e377-7d4f-4df4-b8ea-9d794173b32a','D'),
('14fe7a32-6ce4-4166-b61e-943ad6ab4f9f','D'),
('15165d49-c7b3-42bc-b2e9-f46195e151ec','D'),
('1545d652-3c85-429f-9354-a753dd6c8afe','D'),
('156bfbf2-63e5-49a1-89be-8a65e08b1309','D'),
('1576452b-3fc4-4fb2-a3c4-4356a6a7b421','F'),
('1589ecfd-7ce0-4be6-a3d3-69e324066fb5','F'),
('15c38b11-f304-4e3f-875f-8cdc251c995b','F'),
('15de44a8-2e5f-48ab-9f3c-c022f83c760d','D'),
('161a15e0-f5d8-4f11-995a-20e73c5ee9ed','D'),
('165df98e-f59d-46aa-bc74-a974c0ded83f','F'),
('16ebbee1-c5ae-494b-ba18-f96c395f0b44','D'),
('171038e5-f50e-4bdd-988f-621a7ce9479c','F'),
('17e2a4ff-a54a-473d-9982-f7b41a22a9c5','F'),
('18849c1c-830a-4e84-8968-a9f64528836f','D'),
('18f8f500-f3fd-4865-908f-d30a2c25e922','D'),
('194e5206-bd4d-4ea5-ba2d-142c8bf8a258','D'),
('19ab1b66-ddba-4b06-bea0-f55c9a3100c7','D'),
('19de9af5-6576-4ebb-92c6-1fe53599f782','D'),
('1b049140-90bf-4b45-82db-a6dc259ce0c3','F'),
('1b116be6-057d-48a9-9bd7-dca3f607884a','F'),
('1ba20655-9335-4b3d-a81b-d4368fbad8ce','D'),
('1bc45064-c839-46c3-b424-efb26bf1e95e','D'),
('1beebb19-4155-47eb-be8a-4af53ab30432','D'),
('1c0dee1e-8ab9-4d42-897e-e1dd6da9f4be','F'),
('1c1c117c-bf60-4282-810c-0658f2528e11','D'),
('1c1c12c2-6d0e-4d87-9821-4cbcb3845c68','F'),
('1c33a761-7cc3-4a86-8176-7df20ed53977','F'),
('1c7fc49a-9ae6-4d6b-be0f-893b1b6153d4','F'),
('1c9cd9be-08b8-4430-808c-fe4dab3199eb','D'),
('1cdb67d7-27af-4709-817c-9270bd915249','F'),
('1cf5f118-0af5-482b-9ab9-8cc7043fb20b','D'),
('1d1e1921-5ec0-4bc1-8a51-e9379301e319','F'),
('1d648c29-13fa-4684-86e1-3f61d886367b','F'),
('1d81eaa9-42bc-4815-9616-01ad6e6d5800','D'),
('1d963469-8fae-4bb7-82f0-4bf598c98623','D'),
('1e6efb0b-61f4-4303-9ee8-1569fbf50cbd','F'),
('1ede808f-e293-4b2e-9811-6425f596b2cb','F'),
('1f01702e-320c-4e64-b030-e58fdd47cc07','D'),
('1f44c9c6-18e5-46f4-bf7e-2ed57071f689','D'),
('1fec4774-2523-4f2b-934b-db23a787f95f','D'),
('204a6a80-8b83-4cff-98ed-e89f4da7c4dc','D'),
('205f86f2-41be-4621-ab0c-f0a94074147e','D'),
('2072ad2e-869c-4537-a3dd-0def0c889401','F'),
('20a40df1-c9c0-4b53-aa6e-882e59531bc6','F'),
('20f6af61-75e1-4954-b61a-9042f8a9e638','D'),
('2143ec37-02ed-4712-9642-a56f1945c379','F'),
('217b726d-33a6-4924-8a3f-a95e0228695a','D'),
('2184e5fb-6927-48a4-9ac7-c4d1fcc4b67c','F'),
('223b7d9b-05b4-41f6-ad02-65e3ce6a9ec7','D'),
('227ba92c-9b8c-4705-ba76-181f1f697638','D'),
('229b9abf-0c75-4cbd-852e-b46eb5cfa19e','D'),
('22af2652-f8ae-4b84-8f3d-d2894f435d79','F'),
('22f02ebc-4757-4e06-99e6-f7e4a95720b4','F'),
('23040e91-e0d0-430d-b18e-f9f67c385d90','F'),
('23205f6b-e015-4533-96cc-3b4bec93d6b3','F'),
('2363f25c-c592-4cf9-a521-d458e3e71f36','D'),
('23e84589-611a-44ea-99e1-c51ae7ada6c5','F'),
('23f9f438-cd44-499b-a1e9-227b53d8c57b','D'),
('23ff3ff5-6bb1-4b48-baa2-fc116ac93172','D'),
('23ffb778-7059-45b8-a6e9-ce65514d1619','F'),
('24219aee-cce4-4660-9e80-fac05602aeae','D'),
('2421e6ad-5126-43b5-94a2-80d8edaf490f','D'),
('2430ef3a-8445-4dbe-881a-f42489e485f8','D'),
('2478c921-4ed2-40dc-b343-51c9987ba922','F'),
('24a013db-12b1-40df-b406-0e5afdec4b61','F'),
('24d7c0ff-1b60-453c-8095-836594f30125','F'),
('257b5b68-c021-4db1-92b3-516dccbb795d','D'),
('25842c55-5295-4c44-ba0d-540dfaebb24a','F'),
('25dd6986-a144-401b-8aac-cb733270c0ae','F'),
('25e20c49-15d7-410f-bb88-7161d758c9d5','F'),
('2610f833-88cd-4a55-b255-75b75070b5da','D'),
('26bb68d8-e995-433e-b364-f953aa198783','F'),
('26fc77c4-60fc-406b-bf17-5f4b35777ec7','D'),
('278e60cc-53db-413f-941a-a42fcb9bb510','F'),
('27ebd8e0-2d90-4c96-882d-cff35f91c53b','F'),
('28413120-b60a-4ae1-a2e4-3c771aed4c5b','D'),
('285055c6-96a7-4a60-9033-51f83f49dbcb','D'),
('286514ac-2c90-401b-baab-b8490f50481f','F'),
('288d244d-a252-4410-bca2-f8611dd8422f','D'),
('289adf4a-4078-4aef-9038-ef2c11122456','F'),
('28d30605-63d5-4fc7-ba26-3ecb1a04ccd1','F'),
('29199f64-bb8e-40ce-994b-651a7af38567','D'),
('2928e6a1-4b47-47a1-ad49-a14dee970750','D'),
('2930eb16-c2ad-4cb6-a1d6-7bb650e3cf08','F'),
('2936c42b-ebe2-4fd8-bc70-eee5e263d014','D'),
('294fd624-eb6c-429e-b350-d6e6ef962b77','D'),
('2958f800-0cca-43a8-8486-08e524434199','D'),
('29892770-7f0d-4bcf-a47f-ce790610e054','F'),
('29aff535-d3b2-4d9e-9417-0452241f798e','D'),
('29c910f7-50f6-440a-b841-711b066b0d0a','D'),
('2a66bcd6-35f8-41c9-93dc-53db9272169c','F'),
('2a763abd-8268-459e-9134-c488dfb409f3','D'),
('2a79f912-76e9-4763-a865-2b7a3c00d587','F'),
('2a8c045e-cc0d-404f-896b-7e441a3c495a','F'),
('2ad1a536-aae7-4cc4-ba86-1be967295e1c','D'),
('2af500e1-1665-4468-84d1-e346e64fcb68','D'),
('2b36fe05-9389-47b9-9646-dc2a91d414d4','D'),
('2b5a987d-6c5e-4857-b817-dceb1c5e4e5a','F'),
('2bcac0cd-3340-4052-bd7a-42e2b6b901d3','F'),
('2c73e303-bb61-4593-bcea-8debad14b6cc','D'),
('2d48c8ed-c8e4-4188-a3a8-b0fa3b2da10d','F'),
('2d6c5e7a-7352-4d1d-aecf-c5237d626e3d','F'),
('2db815f9-4302-40c8-b2e3-4bb992e1cff2','D'),
('2de00543-57b1-425e-8ea0-66cb294c1de9','D'),
('2de39d61-a269-451a-9e7c-37fc1aa25ad7','D'),
('2e19fb4b-ce2f-4cb8-83f0-3b44da7e36f1','D'),
('2e1b3f30-cfaa-4aba-8af8-0f9dae8020ee','D'),
('2e26ae7c-0d4a-42da-b8ee-90a498eb25dd','F'),
('2e49e7e8-346a-49ba-91d3-699f1d9e0d6a','F'),
('2e6934d7-6b9b-45fd-9e46-ceaa4c72abfe','D'),
('2f1a9ade-68d5-4b3b-8129-f89fb1868c6b','F'),
('2f957a53-4316-49a2-8ca3-efe437a315cb','D'),
('30064fc2-f1cd-45b3-90d0-c83416a420d3','F'),
('302ba66b-3b1e-4747-9458-84695c70f396','F'),
('305cbfe5-123a-4053-86b8-2c0b512c8e0d','D'),
('3061ba63-e7ed-4537-8b62-9d2c0a8c420a','D'),
('3086452e-9b29-47eb-b6f8-5a9692889753','D'),
('30889b3b-f6fb-4ce9-ac05-9679acdf2240','D'),
('311733e3-1801-4200-8459-4b1983d61a64','D'),
('312e2301-afbf-4d44-b571-1f83c948401a','D'),
('316bb405-cc94-4563-9e3b-5026ab1fccdb','F'),
('31ba2b56-e3f9-40a8-b1e9-d301267a1cef','F'),
('31cf17ec-9b08-41bb-89cc-4da7fb32010c','F'),
('31eb1c41-1349-499b-844c-8c2ea0268590','F'),
('32a4fc92-d1d4-472b-a585-ac19a7e10616','F'),
('33ce9b58-475e-46fa-b677-cc7cf44bf8a3','F'),
('341d4951-c3cf-4446-ac75-6f1448a9bf99','D'),
('345e5562-05ac-4c1f-9154-64bf8339806b','D'),
('348341bd-a92b-40ee-b6dc-5961922315d0','F'),
('34aad110-22db-42c6-bb7f-e790329980aa','D'),
('34e5b497-f995-4089-9dda-2c2ec6817aeb','D'),
('358c76d6-c02d-49e5-92b7-d4ecf7fa77b9','F'),
('3604a78e-2502-4030-8ec2-9904d9989d5d','D'),
('3604f366-9ed8-46a7-a769-c8367b2d3137','D'),
('36355ab6-578f-4d64-9815-86c6faf68257','D'),
('36786473-723c-4104-b39d-eec5bbdeb763','D'),
('37182543-5386-402e-8527-b7e94058f0ea','F'),
('373a7bc7-1505-4c4c-b6b0-ba437b569a8a','F'),
('374d0e7a-aef5-4d09-a2f2-5d4a18568d97','D'),
('38563ca3-66a9-40bb-8053-7a698887ec93','F'),
('38656530-df9d-454e-bd5b-95c1c7f36720','D'),
('387b6e20-0019-429c-b8c1-e6bf5f8e7538','D'),
('3926befc-fcc1-4517-9225-a55519e522c3','D'),
('396ebb6d-2fcb-4a0f-ae7e-6a5856b6651f','F'),
('39708430-d0ed-4eb7-9cfa-24abd3fe2df2','D'),
('39870b8e-3567-4c73-8a52-d707cd6102d6','F'),
('39c25042-f5b7-4f48-9ac0-e8e2560937c4','D'),
('39c80529-9a09-4ac9-8e64-9f55dff498d4','D'),
('39ce9f37-11f8-4f84-a192-b4312a93ba31','F'),
('3a11dd41-59b5-4cf0-93b3-d07a08c5906d','D'),
('3a214221-830e-45b5-92da-9c0cf8ce192c','D'),
('3a7ad729-fef0-4091-b675-747cd760d2f8','F'),
('3a94c68d-2dd2-40b0-afea-96a238b505f2','D'),
('3aae6595-9257-42f6-ac59-8254ecde15f7','D'),
('3ac76bbb-de77-4f26-b2b9-c3408b5bbf1d','F'),
('3b79b8a6-1b55-4ae9-9976-2f5a86d1fe82','D'),
('3b7caeb9-8c1c-4ce5-b3d0-106d019f7d95','D'),
('3c02f34c-967a-486e-9bcb-80caa0a916dc','F'),
('3c1d70c8-c46a-4e2c-bcc8-dbe53798799a','D'),
('3c6742e8-e4d5-4aaf-b9d2-49d4d39a2a4f','D'),
('3c6a16c3-9251-40da-a03b-4ca28afeb750','D'),
('3cbbefb7-1a34-4111-83a1-1e04378a495e','D'),
('3cd88278-29d1-4575-8ba4-eab8ba68dedf','F'),
('3d013edd-352d-4388-a710-a0b9a81a7482','D'),
('3d15bbe7-f752-4a49-be3a-079232d23b0f','F'),
('3d85f161-27ce-45f4-b94b-1d42c62252af','F'),
('3d872c4e-7a37-487e-ad39-9db7d22ee59d','D'),
('3de60526-267e-40be-ab58-f354bf9febc2','F'),
('3e4ff3e2-f212-4966-abe7-4988e5a62704','D'),
('3e509e1c-121c-493d-8da3-cd6e44bd6f2c','F'),
('3e5d2144-c15d-4af9-b8a2-1cb7391e6193','D'),
('3ebbefd2-c468-4853-8576-10104335b319','D'),
('3ebc3050-24ab-4eea-a3f1-74fac5f0b7a7','F'),
('3ec4fbbc-2e0d-4004-8b34-245e8984e8a3','F'),
('3ec90021-2f1c-454e-b87c-b39ce0c8c43a','D'),
('3f03e48b-e5ae-43c4-8d59-516aa26abdc8','F'),
('3f26288c-4923-447a-9f0d-d5d208ab8f8d','F'),
('3f9812bc-b0e5-4b7f-ad9a-78f348dfe6ee','D'),
('3faa1e32-afb8-4b21-9530-2a9fd81c5766','F'),
('3fe15f75-ba2d-4d29-9869-4ea6f2bff168','F'),
('3fe854b9-5e45-42ed-a7f2-23a8207af3fa','D'),
('3fff352f-7e86-4449-8262-5fc50462195e','F'),
('401545af-d273-4f85-b1cd-69f7a5bf00e4','D'),
('4069a4a8-a21e-455e-bb7f-f65f6dd38f34','F'),
('40dce51c-6e58-413b-a364-06fa3a23a076','D'),
('40f9d2b3-14d5-45f8-a3e7-f89d1449d054','F'),
('412a7171-f917-4db4-9a47-c4432d15b4a3','D'),
('4182bdc2-b78b-490d-a02f-07f19aa8c070','F'),
('41dbdf32-aec5-450a-80c8-4d8d226c727b','D'),
('41dc33a2-0635-4941-9465-e66c08757bbc','D'),
('42e7863d-54dc-415e-8c10-89f50aa26171','D'),
('4358b50c-cc20-4e2a-a725-3ecc18e52fde','F'),
('43814ceb-db56-4d31-8bc4-522f0a8533bd','F'),
('4381b30d-631e-4146-a2de-2f01dd1a36e9','D'),
('43edee52-151a-4a82-aea2-ae75ec942cca','D'),
('441938f0-4fb5-4ce0-b17e-0e95caeb8cc0','D'),
('44f1ff92-b5de-44c5-9f7b-319318ff2a74','D'),
('4533f594-2fbf-401a-915a-66b9dca698eb','F'),
('45a5e770-95dd-45de-aea0-7fe2dc0302f7','F'),
('46394a29-9ca4-4280-952e-e201f4ff9517','F'),
('466dff58-e1c9-4e1c-b3b9-e95e92639209','F'),
('46887b99-8cd6-45db-861c-ad24232efbfe','D'),
('474ccbab-1dd5-4481-93e1-418046a33f11','D'),
('476de23f-010f-4bd2-84d0-c0519f532dce','D'),
('47731cb8-58a5-4a83-822d-8e5f8cd8af73','F'),
('4797eb20-c965-47be-8f7c-0ca57ec4422f','F'),
('47dd33b3-1bd6-41a7-951e-8582dae98c5a','D'),
('4806082d-fce7-470c-8868-a8dffb218915','F'),
('4845cbbb-a29c-4b34-8fbe-b8658bd6c16c','F'),
('484d22c4-ff3c-4430-8058-b6f0d8c2387a','F'),
('486a99af-b0aa-4ccb-b5d5-a47b64bc1e25','D'),
('48779a05-e56a-4b9e-a411-c5dc25ea10fb','F'),
('488db5a7-be8f-4428-a4ef-466c0aba8aa3','F'),
('48ada431-72b1-4cdb-8abe-541b9f6b179c','F'),
('48c15f8b-fad4-4ce2-ab71-368c966ed87b','D'),
('48d32719-e7c5-4508-b418-518b18d151ac','D'),
('48f588f4-09ad-4797-988e-1466d21b3c90','D'),
('498f15d8-1f5c-46e4-a330-c40301952540','F'),
('4992b455-1a96-4a57-accf-77d5e9da76b1','D'),
('4a47059d-4b08-4a8d-878c-3debacadeb79','D'),
('4a686160-2102-4cba-b3e5-cfa3b1856602','D'),
('4a7ee87e-8aba-4745-b973-3feae2dfe5a5','D'),
('4aa0d45c-056b-48fa-af36-fc514aee4d57','F'),
('4b2d172a-b413-4ae5-9965-32aeefa0e849','F'),
('4b532a4a-6b79-476b-ab05-b4e0637a52d1','F'),
('4ba85a62-daee-4c8d-8931-8e4414231fd3','F'),
('4bb5f4b5-923e-4f77-b1e8-7e4ab829e7f0','D'),
('4bbd6b61-f9a5-42e5-a6a0-3e175cb94060','D'),
('4bdebc9a-65b1-4c5b-8f6c-012b9c31b4fe','D'),
('4c33f4d6-d84d-40ee-af13-f4b79fadc5bd','D'),
('4c3b0eeb-307b-408c-b209-3953c2e81d4b','D'),
('4c417026-97b3-476e-ac35-18d4455a592d','F'),
('4cb9ecf4-962b-44d2-87be-95fcfa1a2918','D'),
('4ce9fa05-703f-40e4-a14e-40cffc3ba305','D'),
('4ceb0525-5b49-4138-b761-cf4c16e89a34','F'),
('4d5ec8d4-375b-4656-8deb-8e9ab7d342b6','F'),
('4d96ee37-8211-4e5a-b4b6-4b8275bbf46a','D'),
('4dbd99cd-aa34-4c4c-879c-2323aec3cc19','D'),
('4de21b58-af78-44b5-bcd0-6316309a0e62','F'),
('4e5a0000-76ea-4bff-b44e-3c470e5f2434','F'),
('4e6679f8-7ad4-4551-8ab6-8a1168ed95e3','D'),
('4e80cb1f-6989-49ba-9d5b-6ccb32227fb8','F'),
('4ea2c47b-b6b0-4e25-836d-0e9f7bda9d6c','F'),
('4ed0fef4-d9fd-41d0-852d-4a52f4193dd2','D'),
('4ef643c1-5b97-489c-9720-b614b120cbec','F'),
('4f0bbf2a-7a7e-43f1-bc19-c0f937419388','D'),
('4f24efff-2858-487d-adfe-bfc1c46bb1ef','F'),
('4f7f8abb-ba34-464c-9ecb-0ab7a972a978','F'),
('4fc36cc6-a3e7-4603-bd0a-80abc48152f8','D'),
('4ffcc7ec-15a1-4c80-8309-e893ef9db022','F'),
('50702991-15a1-46a0-8607-7ae6e343a6b7','F'),
('50c24ee9-9233-4c16-bc16-3d3726488264','F'),
('5129542f-958c-4693-862d-ff95799e344c','F'),
('512eaba6-84e8-4ffc-853b-44585fe7a641','D'),
('514f3adc-eeaf-4aff-863c-46c9b41a7ad1','D'),
('524c5e74-178c-4e37-9780-3deaa68e6d19','D'),
('529447f3-b4d6-4be2-8beb-5aea79579117','D'),
('5330edb2-9f93-492a-aef3-c7e077c0de68','F'),
('53679882-3463-4be9-84ba-a1dcf00124f6','F'),
('53bc2d7a-5f61-4aad-952c-1b643ea03add','F'),
('5495afaf-d72b-463c-8f51-eaf72b1d4175','D'),
('54a0a8e8-a5e6-4b62-8855-9d68fe69ee6d','F'),
('54f31d33-cc00-4e5a-b562-fb51aa43ff4a','D'),
('551eef11-d58e-4d80-921b-3240252f2865','D'),
('55256246-48cc-4025-87ca-771e433c7044','F'),
('554e1529-71ae-4046-b6d6-4ad703a7b9dc','F'),
('5562bf52-fdca-4941-a0cb-7f994503fd47','F'),
('559c9e97-5961-402d-9a1f-7b17ca55d3cc','D'),
('55b1db30-81b5-4a80-bb8f-e38ba46d5563','D'),
('55ee6465-bdc1-4eb1-b7fd-7630ff315e04','F'),
('56315bf9-8a2b-4625-9e53-c7fe4bde9a8c','F'),
('56dd101e-392b-4811-b662-ae64551770cd','D'),
('57d5af45-0b1c-417c-bc41-64ca9fd1b4b9','F'),
('57f5490a-a29d-42b5-a0e3-c115abf471e9','D'),
('58584896-e942-4939-90f3-d54da2583514','F'),
('586f1543-8f0b-4486-bde5-cb937657ca30','D'),
('58bf72d7-7815-46f1-8fb0-91b2bf565a3a','F'),
('590ae2d3-9e07-44bc-a813-8a2d632aa67a','F'),
('592d5976-51c1-4091-afd2-904aeb3d3676','F'),
('59318ead-b66f-4beb-a217-85ecd64aee98','F'),
('595d10da-6086-437f-936b-f1471d22ecfa','D'),
('5a0cd7e0-174a-466f-ba1d-6d2c80d9252a','F'),
('5a21988c-2eb7-4462-9b76-f4cd028fabf4','D'),
('5a2be214-07fa-49a5-9772-ee47a5fdb6d9','F'),
('5ae9af10-c744-453d-a4c3-bd32c2b9b4c0','D'),
('5ba8dd2b-5ef8-4131-b4a8-877a243a9d4e','F'),
('5bb4ca99-bee2-4bc2-ae7c-4d8b9a4d960c','D'),
('5bb61f42-52d5-4dad-b1e9-c839504dd928','F'),
('5bbd93d5-5d24-4c3c-90f6-0f13f007b238','F'),
('5c3c64a2-4459-44a2-9381-e73a4cd5d0c5','D'),
('5c9528bd-1166-4619-9d54-ee93fb315e7e','F'),
('5cb613e1-c76a-4b1f-98d4-5546c1a5c4e8','F'),
('5cb927b9-ae2d-45cd-bfde-2464892ee0f2','D'),
('5d2d902a-17fb-43c0-97bf-e4fcece2ec8f','F'),
('5d2f60d0-6eb0-4f7e-a968-8eedf3b282f1','D'),
('5d6f67cc-cecf-4791-b1ff-9af16e9a8554','D'),
('5dcd596a-64de-4439-84a3-a79960b44000','D'),
('5dcd833e-240f-4a62-bbf9-2dcb69dcb465','D'),
('5e35105f-31ee-4411-b09c-473f4f46d7a9','D'),
('5e43cd75-b978-438b-ab32-3f9d74151c9e','F'),
('5e655782-c9f7-4bf1-b18c-e2a0e7974bfd','F'),
('5e65716f-140b-44d9-8e9a-2aacf8b50d8d','D'),
('5e7e99a1-f123-4c7a-8a5a-bb760dc9ef25','D'),
('5e94c522-895b-4d63-9948-fb077adc371c','F'),
('5eabbbc0-a3a3-4ff5-8329-f94c35f59722','F'),
('5eaede5f-ddbe-4d8b-b143-d9ec2bd4dd23','F'),
('5ee0f97f-537b-41b2-a6e3-c7dc3b01938e','F'),
('5f2ab19d-c86d-4689-bb39-bd1e4cf02d32','F'),
('5f75b48b-5715-4e29-aef2-c9f8d0567ec8','F'),
('5f7757f0-31e1-40f3-9daa-e2a3fcc064f3','D'),
('5fd06d07-ceba-44fc-9322-dbafca83f370','F'),
('5ff11777-a6c2-41cd-b2b0-56c3576e73ae','F'),
('603d3e1d-857c-4117-b12a-d4558360f711','F'),
('606719d4-ff19-410d-8a44-40810f8c2780','D'),
('609f2e4d-cdaa-4975-8b9d-f6750e4780ba','D'),
('60e31431-564b-402e-a574-96db4b774e06','F'),
('60f7edc9-f93e-43da-833c-1dd10caef345','F'),
('611cf850-2298-4a87-8c1e-9ac0a763c486','F'),
('6162b471-d011-41f7-ad89-9a8d856c9ffb','F'),
('61680aec-98d4-4ec5-b5dc-e6e0bedb1a23','D'),
('619d99fd-faa3-4c5c-a77d-21259f5fc2a0','D'),
('61add065-9a5c-45d4-a06e-1f87a57cc656','D'),
('61e113cb-fcf7-4248-90c4-a45ca9e8674f','F'),
('61e51804-44c0-466d-a5d8-e9e5316f9f8c','D'),
('6258f768-cb01-4edf-9508-a40fedcdd49e','D'),
('62611529-4764-4634-bc1c-a596a4ae428f','D'),
('626120fa-7f5c-45ab-9c9c-25a26978edcd','D'),
('6272db54-085e-4713-bcba-f0a7b18e1c7d','F'),
('6288fdc6-3059-4601-be18-dc98795ab90a','F'),
('62c2fc6c-e6e2-4a6a-9b47-e038bcc5a5db','D'),
('62d0cfe7-d505-43e3-ba83-aca280237051','D'),
('62e945f7-c4ae-4462-bac8-64a992b1b688','F'),
('62ec986d-3b9e-447a-bfa9-c0310bda36ad','D'),
('62f0d4da-b736-4629-ad14-894e432d0f04','F'),
('6310d28d-4dac-47df-87be-4f667e50a3c9','D'),
('6313dbdb-f274-430b-8c98-acdfc07ca816','D'),
('631a3049-dbb7-4668-8d52-c36efdb395d5','D'),
('632df610-5d0d-48b3-b7ca-906d3db5643e','D'),
('636ef755-dd57-49c4-8623-038fc9a9c635','D'),
('63a2c2a3-308b-49d7-9018-9e2d28e31f5d','F'),
('63a755f0-c27e-4baf-ad3d-a3716f86a9e7','F'),
('63de1ab9-12ac-4049-b0fe-eec4993e9fb0','D'),
('64168748-ce1d-48f4-884d-3c77d69d53d1','F'),
('6443a6ce-03b6-4baa-99ce-381352d2f277','F'),
('6471a019-2121-4486-98f4-87ba46ba3a15','D'),
('649d02d1-ce26-4c24-adde-b3f428ec2353','F'),
('64ad9eeb-d4cf-43a1-bcb3-bc580f902361','F'),
('64c24f0a-9dd5-488b-acd3-8762f102804d','D'),
('650f193e-e50c-4239-b243-eb25384a4ae7','F'),
('6516567b-4394-404e-8170-e2a21dae7b48','D'),
('652899fd-f80c-4903-bd5c-9999c946ae49','F'),
('6548dc2b-21a4-4c36-bc8f-7fa1a604644a','D'),
('65f99ae2-cd2e-46a2-be72-c47361552350','F'),
('660bd7a3-f116-4868-830b-62101ec71dae','D'),
('660d14dc-9f42-425b-9985-55644a95a984','F'),
('66188599-c421-42fa-a36f-d5ebfea530af','D'),
('66417bd4-c8e5-4666-af6f-3d85a43593d9','D'),
('6688345d-e7be-49bd-a318-4ee1e6b10253','F'),
('669a0232-3b6c-43bb-b6f4-c5e37f1ddfbf','F'),
('66bfd1ea-43f0-46eb-bf70-35c08a4db945','F'),
('67031c9c-6286-49d6-b00b-893737522f3b','F'),
('67d92504-ee81-4d7f-99ca-f79c752cb265','D'),
('67fc8a8b-46d7-4089-9847-f645c047d1f6','D'),
('681b2902-7aba-4d91-9012-ae90670280e2','D'),
('685612fb-e4cb-4265-af14-e6132539bad1','F'),
('68994f6c-cc0b-46c9-b3a7-662ef58aed3c','D'),
('697d34f5-fe65-422a-b624-5a4957ef4196','D'),
('6982b905-d55f-4fb8-b0af-8f24158f2a63','D'),
('69834886-615f-486d-90c7-7efe1c7f9ee0','D'),
('6a1fad7d-e358-43d0-b019-13492c9d2bce','F'),
('6a224502-85e8-439a-8372-a000a6d2a19c','D'),
('6a48eec0-2efe-447a-b902-13a4de739e53','F'),
('6b3f4393-3ccb-491d-bce2-361b3385defe','D'),
('6b8edb63-36e5-478b-ac6e-cd1021334a0d','D'),
('6b95593e-99f2-4555-b53f-9d93fd2b91a9','D'),
('6be16e8f-d589-48d8-b7bc-61fe0ceca3b2','D'),
('6c0e646a-96f4-4b90-a71f-fdc400193031','F'),
('6c666c8f-84b1-4039-bf82-db3f40036b3e','F'),
('6c81d309-eee6-45c6-acf1-aa848af6e86d','F'),
('6cd9867c-92f2-495a-8e13-d52df8276de5','D'),
('6cf64a8a-04db-458c-ab06-18f559163143','F'),
('6d056300-ab80-4565-951a-583b3c17ba79','D'),
('6d301010-3315-4694-b55d-812ae56110c5','D'),
('6d6b3cc2-f6bf-4ea6-bffb-5e450625ef02','F'),
('6e33b489-036a-4495-a6e1-3e0720c9397a','D'),
('6e53238e-0b78-4a67-b7a2-eed9e8e7d9b3','F'),
('6e79dd95-9d25-4450-a6e5-43cc0e659303','D'),
('6ebcbd12-3e9d-4d5f-adc7-b8f53a7baa9a','F'),
('6f5fd01a-cdbe-4c2b-b472-f4cafcfdad17','F'),
('6f9ee58e-e1e4-446d-bfa8-7d10d1af0aaf','D'),
('6fa1c8e2-c2bb-4168-b121-6281a549b94f','F'),
('6fdfcb70-b8f3-4ed1-89ca-a7d8af136dfc','F'),
('70324f24-1728-4bb5-89ef-3343ab570beb','F'),
('7046eac5-294b-44c1-b682-2950b541a031','F'),
('704a1983-c465-427b-a9b0-b911be1860b1','D'),
('70a7e704-0ee7-4918-a990-963278e01443','D'),
('70b5de2f-1303-49fa-a2fa-83c53e8f02b3','F'),
('70be5a51-133b-4bba-b262-6e2424c5bcfd','F'),
('70ef34bc-1165-4f0e-86e0-044e82c04d92','F'),
('70f55b70-846d-4bbc-860a-4c41b65d3ac4','D'),
('70fa710b-3180-4ae4-98fd-95d4f9eb8d7c','F'),
('710c13a2-68e6-4530-a9a1-9f9f1274e9d5','F'),
('719dda77-bceb-49c8-93a1-bda7b38cd57d','F'),
('71efcdb3-a39e-4e4d-9039-337de85f3eea','F'),
('7210181b-c61a-4c8a-b210-7942d472abe3','F'),
('72212861-73a4-480d-9453-569a3c44e6b5','D'),
('72f2fedb-a5f9-4d10-b147-d92e18102d3f','F'),
('736d7a11-0585-444d-8a08-693a16032681','F'),
('740e9ec1-0995-41d3-b12d-635a92631592','F'),
('7508c26e-5e7f-4b6c-8c5c-cac800c9d0c9','F'),
('753e81a9-1513-4923-be2b-bd684ed7133c','F'),
('75f64f35-c437-453a-b241-73d9d76dda70','D'),
('761b4352-ee05-4423-a791-65303d364989','D'),
('765c3cc9-ed6e-4a71-bb54-568301a17b55','D'),
('767508e4-917a-496a-8412-c5ea94c80a1e','F'),
('767bd910-5e57-4df5-9a06-9fad7cc51c15','F'),
('773d79db-bbe8-4ed9-9829-8eec754b3801','D'),
('775f4778-ceda-44bb-a26b-7c4194c8c0c1','D'),
('778972f6-be6a-45c3-8f57-d37aa1adb5da','D'),
('778cab7d-2b73-4f48-b617-bf5fec0c59ed','F'),
('778f8033-c9e2-45fa-98ca-935f38e2b8ca','F'),
('77ae84b8-e525-462c-970f-34df8f03dc12','D'),
('77defa28-748c-477f-830d-b35006851b49','F'),
('7817543d-9a93-4cdd-9b42-3dadac9d8b31','D'),
('781b24c7-12da-412e-a76a-91d3eb4227c3','D'),
('782eaa11-947d-4665-9e89-50cf52f099b5','F'),
('786eb11f-4b5b-4be3-b9ac-ae8bda773f1b','F'),
('78d65d90-7234-4d43-816e-9c29e81dd33d','F'),
('7967196f-a0ca-4ac7-8e0a-46ef2b007abb','D'),
('7983780f-68af-4cf7-b263-45443d9751af','F'),
('79a7f270-a3d9-495a-b5f3-a7b7600374f8','D'),
('7a6e8b45-c2c5-4eb3-bf24-e69916e6c97e','D'),
('7a720598-8e36-48e1-9826-7bc99a81bdb6','D'),
('7a74d9fe-baef-4224-b20e-cea476853795','D'),
('7a98c446-fe87-42b9-8525-1e693846d0ba','F'),
('7ab3ae51-4325-4648-af22-7ba84283f7bc','D'),
('7b05f19d-b546-46a7-aa12-982d78d6f802','F'),
('7b5bfac4-f50e-4532-b828-b20d972984fa','F'),
('7b9a7c74-82b8-4d2c-ad9d-eebe4fb999f4','D'),
('7bf33d87-128f-43b6-9207-069081632dbc','F'),
('7c0be9c9-51e8-4c46-a3c0-a1a9aa4d1719','D'),
('7c165d15-db68-46c9-89d1-b7f0533a3f13','D'),
('7c99ec12-855a-45dd-9bec-00b83f053ffa','D'),
('7d0571d3-5d40-4aec-9a30-8e36e81ae9a1','D'),
('7d1b678f-cea8-41fc-873e-2ec47ea5c318','F'),
('7d2a36ee-19f0-4d5e-9600-9a2cd996c0b9','F'),
('7d35b9be-cea2-4e45-a1c9-4372d74024a3','F'),
('7d7a80a2-092c-4338-878a-0416611b249c','F'),
('7e2aea2c-a267-4cf5-b90c-546acbd4466c','D'),
('7e464f21-760d-4682-a6df-f8d89030d519','D'),
('7e4ba828-ba3c-43ca-a9f7-8a697be64c15','D'),
('7e52a91c-4372-4b4e-aec2-5b7d59f19730','F'),
('7e886564-2f3c-41a2-8d6f-0b252b865893','D'),
('7ebc2bb7-c556-4c70-a682-393cb3fc1cdb','F'),
('7ef06129-f9fe-4180-9528-f210037f846c','D'),
('7effd428-e607-4430-b383-47c438b10143','F'),
('7f2fcb20-a23c-4003-b2de-f23c01460d71','F'),
('7f348e8f-a98d-4bf8-8f59-e34a78d1f87b','F'),
('7f554d21-df8a-4b3a-9eb4-45a081382e72','F'),
('7f99084b-e99a-4312-a258-1be6451c0c8b','F'),
('7fa09483-7386-4777-9192-a3c775a30005','F'),
('7ffbf0aa-b2f9-42c2-87dc-26756309e17c','D'),
('8037b1c0-ddb7-46c1-a068-f11080d7771c','F'),
('805ae5c3-5303-4aa5-b600-741afb76506e','D'),
('80e564eb-1b5d-42ba-bd12-9af5f89fecb0','D'),
('81230f8b-680b-4e9b-873e-6c22c46e96a5','D'),
('813ddbd7-65df-4086-8556-3ea7c16ab870','F'),
('81c5eb8a-3aeb-443d-a616-207527a939cf','F'),
('8201618c-0e6a-4d0b-af2f-056156e8b608','F'),
('8268d71c-6cd7-4897-ac17-d0cad40b7edf','D'),
('82861181-5a96-4e7b-bfa4-b75ca2bd145f','D'),
('82c24bec-26e3-476d-ab10-b9b951e1ce93','D'),
('82f3163c-ba3d-4faa-829a-77113abf2549','D'),
('8327a08a-77e7-4f33-be45-e086a718c9e2','D'),
('8338bf08-f33d-481e-9072-fba81076bc9a','F'),
('8339a681-3944-440c-b9fb-1746b58cd308','D'),
('83483253-cbb3-4fc9-925b-4905e5450feb','F'),
('8376185d-fab8-483c-a004-52c8a5cce763','F'),
('8384a11c-8930-4b0d-a1c9-748f03569a78','D'),
('84385ab0-d3ea-44c1-8e93-6fa6b1d25457','F'),
('8480aae4-ba71-4f28-b1b8-8489808fb902','F'),
('852b2be0-4983-4507-a687-fc12f241960d','D'),
('860b72be-1729-446e-97be-6810b9fbfbfa','D'),
('86468a23-14cb-4602-92f7-7e270197fc3c','F'),
('866b90b0-dc59-4123-8bf1-cc2f3d5f6d34','F'),
('866ca9e0-8560-41d4-a2c0-aad24dd523bc','F'),
('869b7283-6da3-4b6b-9c19-34d35921f3b0','D'),
('86e42f5e-0fd3-4f59-b1ec-8a300f0ff391','D'),
('8703e327-5739-475e-b256-8eca013b9b7b','D'),
('878cdf61-681e-464a-8eb4-989951a978a6','F'),
('87b95987-26a2-4319-9388-b83c89909cbf','F'),
('88056a18-39c6-41d8-bd36-5fb0bfb00ce9','F'),
('88323ada-b230-4313-bd13-e3f11b4fe987','F'),
('88c87c2c-fa78-4a9f-8fc7-656753b5cf59','F'),
('88e2d7d9-2c5a-41b0-a25d-c5643ba4ae67','F'),
('890b3040-18ae-4cdf-a7c8-c2df3336765b','D'),
('8915cc13-451c-4ccc-822f-afccc5e1c686','D'),
('8964a644-c3e0-4297-93d8-ab1113c363bc','F'),
('897ad7c5-d734-4758-9ef9-29230c4b68ee','F'),
('89822056-9b50-4361-a4bc-08f381515f28','F'),
('89a23158-4840-4e26-b9b6-d837eca341ad','F'),
('8a1e2ff8-aaf8-470c-9d15-d04339b0c6db','D'),
('8a7faa73-bf76-4940-9b80-39e95163ffd1','D'),
('8ac71583-0d59-47af-899e-b4cea19e1fc6','D'),
('8b2ffd4a-c54e-4f1f-9fe7-e0331f913852','F'),
('8b3b6f26-589a-4532-8392-003fddfb7d1b','F'),
('8ba5f4d2-91ce-4d7b-9182-192663784a92','F'),
('8bdb54a1-d614-4932-84fa-795dd4728828','D'),
('8c3ac914-6aae-4937-b438-ba1def687aef','D'),
('8cd4e346-50a2-4335-a998-c958cff2e260','F'),
('8d100b96-c791-4495-a7ab-0ffff40719c9','F'),
('8d44aa1c-b7ff-4588-8dac-340d5aacb0c2','D'),
('8dfe9ec8-b899-4f51-b3df-87f4a33cbe5b','D'),
('8e30089b-cad4-402d-a477-7fcdb3db8d05','D'),
('8e5a0e02-7832-416d-970f-f6f74e181dcb','F'),
('8ebbb163-9dcd-4e3f-9806-39a171a3342d','D'),
('8ecf28ab-9f60-476a-aa2e-dd6ba71f3cbd','F'),
('8ef81aac-30ee-4ad5-bc83-20f15046f37d','F'),
('8f4acae4-1768-426a-bf4b-17d8cad7c02f','F'),
('901d7bab-fc2e-4594-bdea-22930a922d22','D'),
('9049783c-3419-437e-9dcb-b0d193efd36a','D'),
('9089aa52-d4dc-4588-88d1-11132a674419','F'),
('91dfbccd-e521-4821-9cdc-3d058a0060e4','D'),
('91fe8059-cbf5-40a3-bc14-28d169dd4bc9','D'),
('9248f14b-ca68-44f1-9e5b-be79e3cc84cd','F'),
('92655975-8766-4c4d-b266-a822055dc6e3','F'),
('929f7224-6689-45a7-aeca-9c7226c82630','F'),
('92cd4964-6206-4989-9730-b7959bae6dc5','F'),
('92ecbaed-bdec-49ae-96db-90e3d61a8f7b','D'),
('9313a5e1-6f18-4829-be70-c932adf12625','F'),
('939e0a53-3152-49d0-8929-6c20447359ea','D'),
('93e59b77-4237-4130-a1d3-2d9ced856e0e','D'),
('93ecbb64-e602-47f1-a314-056504d6b3be','D'),
('948bf927-81cb-46d8-b033-08d5f8b35bf0','F'),
('94cb32db-d0c0-408a-9a4f-13e66d56d2c2','D'),
('9585521c-a98d-4880-a915-c7248289a162','F'),
('96435447-ba23-47cf-8ae0-a98826422bd5','D'),
('976a1999-2709-4730-bb3c-36558a4939ab','F'),
('97a78c88-d500-421b-bff0-992271e24b09','F'),
('97bdc83a-7e7c-45ed-acf5-a9b48309fdba','F'),
('97e77c3a-16af-4e7f-9a83-9fd91c958067','F'),
('9830c0e9-a23f-4719-a8a9-26b12a9bf8e1','F'),
('98327012-ff16-4a4c-a6b6-3f5e6e3cba2a','F'),
('98879512-5e3e-4dad-827d-6e62c950642d','D'),
('98a83060-dc09-4763-9bd1-adb8c8af0142','D'),
('98b62cbe-0d51-474c-88e1-f89d022899fc','F'),
('99079d3e-4df5-411c-be9c-77878eebf5f9','D'),
('9932ac4a-0daf-48ac-8365-b6eeb4d7a8e7','D'),
('9955b043-1a7c-4eb0-8130-97eb9fdecce4','D'),
('99be32e0-aeca-4b28-a653-99b746f260c4','D'),
('99be4f5d-60d2-4827-bd31-4af5412769d1','F'),
('99d046ab-7753-49ef-b33f-aad003f397fa','D'),
('9a195ad3-15f3-4b47-aa0b-2d5f0634462b','F'),
('9a33bf74-c467-4201-9339-6739eab2be3d','D'),
('9a3debc9-04a0-4006-946b-801a481e07ea','F'),
('9b2787f1-04a4-4d6c-a437-c387fae89627','F'),
('9b5d1b31-baef-4bf7-9ccb-4734199a1fa1','D'),
('9b8e4658-9315-4b06-bba9-2d76d72a9f09','F'),
('9b918b56-08d8-4a06-b8a0-de2bf4022303','F'),
('9ba3cec3-f2f2-43ae-adf7-16302170b128','F'),
('9bb330b7-a66a-4c52-b19c-d932ae07a354','F'),
('9bd731a9-e89d-4177-ad3a-854f6f8acfae','F'),
('9d46745b-2008-420a-8150-88e265da1736','D'),
('9da2d0b7-436d-4e47-826e-4c30077428a4','F'),
('9dc34048-3e89-4d93-8fcb-d3cac17474c5','D'),
('9dc5344d-403b-4fe1-951f-66b091d52e85','F'),
('9dcf6e6b-ffae-4336-87dd-92a893d1b27b','F'),
('9ddd885c-cafc-4a73-82a6-1d0385a3ca8f','D'),
('9e5abf96-3fe6-4bd5-8641-d6c95d5b64bf','D'),
('9e5d90d4-efff-49e8-a93e-29d755eed6ca','D'),
('9eaea36e-45a9-4864-9773-16a0577d7f79','F'),
('9eb2a231-a42f-4162-8818-3f14ebc19385','F'),
('9ecd6262-2315-4bc6-a77c-d842033c08bd','D'),
('9ee591b7-2360-4ea8-ad3b-942ef829fbda','D'),
('9f0996a4-623e-4f65-a5cb-f36bc69ddaab','F'),
('a040ed35-98c2-4354-bb82-476c24184047','F'),
('a04d3a50-ecaf-4baa-ba5f-c5597ae5d0cc','F'),
('a0b37838-f752-469d-b41a-b999cd77b1ea','D'),
('a0d2909b-4b76-4a44-b88d-781ccca63623','F'),
('a0dbce6c-9df7-468c-b1ba-bfae2e31e774','D'),
('a0ff4035-2622-4f8a-9124-055c04a56be6','D'),
('a1601ac1-9fbb-40fa-96c3-4c884ee3a846','D'),
('a1bf8c9f-ad73-4e20-86cb-f061e3223083','D'),
('a23ca5c9-b748-482f-9b59-9db35f7aa996','F'),
('a24711c1-49db-4b14-bcad-341997864253','F'),
('a2bd256e-014c-4504-97c7-6bc43242fef1','F'),
('a2e7b8de-2edc-4440-bf22-7f04bf1cb5c0','F'),
('a354ec75-5c09-4773-b94d-8634c9104788','F'),
('a3810172-4269-4663-a40c-767cb7ffa01c','D'),
('a3b03c4b-b3d5-4045-b820-c2584f9021c5','D'),
('a3dc354c-d100-46e4-a0a2-2c42fb22a6eb','D'),
('a4066678-8d15-43c1-9e05-627cc693540a','F'),
('a45c237c-495f-4696-8fc1-b73f8a39fe62','F'),
('a477eee0-c67e-4c09-ad19-974f41779d7b','D'),
('a497dbb8-a32c-4bb9-9ffa-beeea1d8c5d8','F'),
('a4dc9d75-4f09-47ca-8bfc-ad29be5180ae','D'),
('a51e2ad3-69aa-4bbc-a82c-06a6581572bf','D'),
('a53766a4-b9bc-4321-b37c-f220b2877910','F'),
('a5e2f927-126c-454a-ae28-840b56bdb1dd','D'),
('a621706d-e8ea-43d1-8d28-76c1d82f21a1','F'),
('a666df27-5645-4d05-b628-090950eb8598','F'),
('a6951550-6ec2-4359-a0bc-8c2f66fc5078','F'),
('a6cd08f3-d81f-4d69-a4bb-42e869393a9d','D'),
('a70a0d4c-232e-482d-898f-37518fe134bc','F'),
('a74c2c28-c2dd-4ad0-b18f-2687eba73dba','D'),
('a78bdfa3-d6d5-4843-9b90-b5f93afc9510','D'),
('a7bdfc35-1e53-4346-91d5-49c9f239984a','F'),
('a7d90ad1-1f5f-49dc-958a-051ad859d20d','F'),
('a7dea671-6b1f-4d90-abe1-2abbedca4e96','D'),
('a85c6ca0-7610-44f1-a786-3b8ab4bf7329','F'),
('a89c9986-4fa4-4e3b-9353-dee4bcdac5dc','D'),
('a8b3189e-28b3-4e0c-8fc2-5e41cad97077','D'),
('a916c222-1eb9-4e73-89ee-a92e289b80eb','F'),
('a93a8432-a399-4ac6-9005-3c77f1e37080','F'),
('a9fbbefc-e39c-41c5-afdc-251f7eb76b4f','F'),
('a9ff80c3-8482-4206-a6c0-ea4cdfd81698','D'),
('aa67ba27-46b6-45c2-a392-a4df0abb069e','D'),
('aaa1dbd5-baa8-4503-8681-26ebe1ccf8a6','F'),
('aab5a8fc-f3a8-4f7f-b5fc-5c2e61553caf','D'),
('ab31057c-5141-4f45-bc31-cfcbc29a38e0','D'),
('aba9beb0-16b9-420a-8247-f5ceabe76b47','F'),
('abc0a16d-7631-4a38-8fca-1799b2385d66','D'),
('ac254a0e-a02b-49be-993d-e89a5803a653','D'),
('ac4873a3-92d8-42a4-97bb-d2bb410c12e2','D'),
('ac61ed82-19cf-41b9-a65e-cfd099da1ecf','F'),
('acbf88b1-55c3-4868-bff5-19b9ba9de296','F'),
('ad0c8518-f9e3-4341-a1db-dccf83145838','F'),
('ad5bd851-25d0-4dab-ae73-d1297298a08f','F'),
('ad66f252-28fb-4ffd-8242-fcafa290f852','D'),
('ad7951e6-88d8-4b9e-807c-bd9753790e66','D'),
('ae0bc48d-f98c-4b25-a9fa-e3522f986173','D'),
('ae1646f4-7c06-4a9c-b69a-9931ffcd5777','D'),
('ae65dc7b-1be4-4f56-a9a0-2fa660095119','D'),
('ae6a3785-9065-48d7-96c5-c8858651a31d','F'),
('ae75d87e-d808-4b93-a176-c1a004a80233','F'),
('aecab0a3-191a-4c26-8f72-cc0de7a975c6','D'),
('aef849b8-2906-4dc0-b108-251710e76d3c','F'),
('aefbd1c7-a2db-4bd9-b24a-333e18edec16','D'),
('af769bec-4c06-4176-9ebd-9c1c20df3a1d','D'),
('af98ffbe-1de5-46eb-bb1c-86e710e62ee3','D'),
('afa6c823-103c-452d-b6c9-929ad0163dd5','F'),
('affd7444-d0b7-4904-ad1e-bb06d0f58525','D'),
('b108a3c8-e453-4d57-ae40-08de5e9f9273','F'),
('b1643d27-2d86-4d0e-9fbb-0dc1c0b78093','D'),
('b1c1f504-bc94-4dfa-b937-24d0ed41fd62','D'),
('b1dc9c62-fcda-4499-a66b-1fdacaa99e65','D'),
('b1dd1863-7dab-47b5-b35e-548f951a7619','D'),
('b23d2455-d884-42e4-901a-369db50e5cd0','F'),
('b2e5bf5b-f6f3-4156-8998-29831e390fa3','D'),
('b439692b-fd8f-4a99-85fa-38f37111e733','D'),
('b46c6190-ded0-4da6-8a51-b327cb3ebc04','D'),
('b474bb12-d6ec-4ea0-b661-58811b604b97','D'),
('b4cd2cf5-7b88-4383-9b3c-d1cc231828e7','F'),
('b50106f3-48f9-4fb6-8ca0-a361891a670c','D'),
('b50221b0-f427-432a-8d84-0f5a76112205','F'),
('b57ec015-fa84-4aa4-81b9-05971e5ceb2a','F'),
('b59cb3bd-5830-4539-b53a-98e915b45397','F'),
('b5aa6a25-66e8-4cfd-9188-f26623e0bb42','D'),
('b5b6395d-e618-4536-8ea8-5b89ee3878d1','F'),
('b5e78a91-cc79-4fb0-989d-b47da1363a33','F'),
('b5fa9dcb-bc18-4806-b308-3085f42fbff2','D'),
('b5fb0b59-88b7-47be-9f52-6946c68b31f7','F'),
('b641622c-bf2b-49fb-9da9-be510f380c06','F'),
('b661053c-f8b9-4938-ab8b-92c9e2f647c1','F'),
('b6bfb4e1-95dd-4d05-97bc-630ff682047d','D'),
('b6d34da3-9b2d-40b9-9dc3-8a46b74e651f','F'),
('b6ef1688-0c5d-4f2e-a8a5-83363d415e78','F'),
('b70a8510-70b4-4c2f-a545-77a7b973aa5e','D'),
('b7804a7e-c068-4496-bee4-c3a582a33816','D'),
('b81a0d08-bb8e-41be-9371-ab7b1808cc23','D'),
('b82cb704-5ea3-469e-b05a-88e768e8834c','D'),
('b832b6c4-f58c-4b53-999b-48c9fbd1ec3c','D'),
('b83fa747-e51f-46c0-85d7-6a2f68417309','F'),
('b886e793-7c9d-4ea0-8677-244cc06f3fc2','F'),
('b8ad8459-e8f8-47a9-aa71-950508512077','F'),
('b956dcdf-e8c5-41de-914d-63fac3989b1d','F'),
('badcd43c-1a7c-4a71-82d2-a2315758d8ed','D'),
('baf4b2c4-c335-47bd-be52-a992d71e35d8','F'),
('bafc4741-38d2-4b84-b081-30509c565412','F'),
('bb01946f-5753-44d8-93f1-5c32062c3d6b','D'),
('bb698b9a-2861-4ad4-a051-bba7b7ec4e85','F'),
('bb6b201c-189a-4363-adc7-30aee6c2c743','F'),
('bbbe8009-75ac-4c8a-a483-9bf6b60fdf53','F'),
('bbca3b33-152a-44da-91f2-d63e5a2354d5','D'),
('bbcaaed4-92b3-4ad7-86ee-7770bb36751a','F'),
('bc1b7867-4e3a-468a-8b84-e80387a21778','F'),
('bc2f1ea8-e757-43d5-92dd-ed586ab6685c','F'),
('bc43a03f-cee3-43fc-8470-a4c605127316','D'),
('bcc2a80a-9731-4dc1-979d-892943c8568b','F'),
('bd7961a3-9ce3-4be0-84b2-4b20dc311f84','D'),
('bd968722-f2c3-43f8-8bfd-77294aac9ca9','F'),
('bd9b7405-4543-4e63-b82c-9f6126c6443f','F'),
('bdaa78a6-95e2-4456-9bce-cdb6cd505f4e','D'),
('bde32aca-5706-4049-b6a0-433c13321435','D'),
('be61d864-3269-46de-976b-06871c6ce271','F'),
('be7ecf8c-6597-4c3d-8583-f0f1ba94ad35','D'),
('be96b573-6518-479a-9fc9-5576fed8e63e','F'),
('be98dfd6-ee41-4307-b065-c8bf97e5f4fc','D'),
('bf3263c5-bb5c-4858-9c41-a94afbadcf4e','F'),
('bf7f659b-0e5f-44c9-aace-bf6ae2cf035f','D'),
('c005d672-bb67-4070-a5e3-77b55d25c4bd','F'),
('c0129701-3117-4d31-a342-59bf5d2d31e2','F'),
('c025d7b4-b93e-4aa0-89e5-e391c246b0f2','F'),
('c04214c5-cf54-4486-a7f6-8b6efeaa82dc','D'),
('c0553605-4f71-47e0-a127-c37150408196','F'),
('c058ae6e-8331-4d25-8245-4da7fbfa3fd5','D'),
('c05b9dcf-8a6f-41c7-ab80-0e84228d3ff4','F'),
('c080ed25-5d53-460c-bdcf-64e02a9d416a','F'),
('c0bc49ab-c313-4986-88e1-16835a32176a','F'),
('c0e8a3a2-dcae-42d0-9c13-3680aaab700b','D'),
('c1b575fb-3efd-43b6-b314-353e1d300aaa','F'),
('c1e995d1-41e7-440e-bd64-aaecb01c4d3c','D'),
('c1ecb590-e6bb-4a7a-87de-95bb44673efc','D'),
('c2bbe90b-bd79-43a2-8d22-5c60a0ec3855','D'),
('c305788b-b2b9-448a-9293-ebe3d8d1162c','D'),
('c3195f0b-2da2-40d1-b1fd-42ab69e55edf','F'),
('c34d15e0-0394-4eba-bfc1-c6c11827216c','F'),
('c398e806-141b-49f9-9ea5-26d688b4c269','F'),
('c3daa53d-b161-4d82-8204-9359511b0bf8','D'),
('c401b45c-8a60-4480-9900-f452454d77be','D'),
('c402b38e-7ba6-40bf-a2d3-d65376d28ccf','F'),
('c46f04f8-3d62-400c-802f-7f757665513e','D'),
('c49b2414-97ff-461c-8c20-3c05fe09809b','D'),
('c51f42ef-b963-402f-a5c7-2095dba45ead','F'),
('c649f5ce-726c-4426-bac5-c1e63d249dd4','D'),
('c698bb3a-2245-4b35-a75c-43bd0649a133','F'),
('c6dbc079-20e5-4df3-a2f7-f335460c632c','D'),
('c6dc3bfa-d9dd-4174-9704-d4a0a285f876','F'),
('c702f6e3-a7c2-48fc-b3be-a965ae81289f','F'),
('c73bc8f4-5cb7-462f-8405-7b4716b35d5d','D'),
('c7a783ee-ac19-4a86-8e26-422666281805','F'),
('c82e74af-4101-49b0-bd0f-93755f7bb13b','F'),
('c8f5500d-03f6-4cc8-a8f7-e439af601aba','F'),
('c92d92ba-2358-41e7-bc22-13107f718ec9','D'),
('c97784d9-45ce-488f-ad17-130d569e16be','F'),
('c9c01154-8fbd-4621-8ac8-bfa7d17bf026','F'),
('c9c52564-cabf-41be-9e3e-31e2895d403f','D'),
('ca898367-27eb-4166-807e-0e674f11aca8','D'),
('ca905025-0dfc-4353-ac1e-444ce5763c83','F'),
('cb35cc6f-3150-48ce-b7dc-887b6aca8327','D'),
('cb50fee0-a87b-4ac8-a6fe-8e665c5ddd8c','F'),
('cb78cc2f-f388-439d-a6a4-540c7c1899e0','F'),
('cb87b373-8305-4261-874d-24425148f3b7','F'),
('cba6d788-80d9-43e3-a151-005e76b32701','F'),
('cbcc055c-3d51-4d15-b26b-529d215d137d','F'),
('cbea112e-42fa-40b8-9578-4f9b048bf574','F'),
('ccced697-01fd-444a-bf95-65b720a3adc9','F'),
('cd337e9e-5c1a-498b-9bbf-a4e30d00ffe6','F'),
('cda69887-ebc4-47e5-a4ce-6e3c810b168c','D'),
('cdc197ee-df2d-408c-9928-c67ae751a935','D'),
('cddb2fa8-143a-46c8-8c1c-25b9dd78ec26','D'),
('cf0da9a0-5937-4260-ba92-cfafcb490226','D'),
('cf17ebeb-7337-45c4-97fd-d1a7fd3286ad','F'),
('cf36cb99-888a-4a2d-ac44-6b9a2196f9ef','F'),
('cf8e99b0-7b65-4a2c-95c2-ff55f054c6ec','D'),
('d0521cf4-646f-4f75-84fa-e478f33f9a19','D'),
('d07cf5cf-9aab-4e9f-b281-e243536778ee','F'),
('d0a1f18e-c8a1-4757-b32c-754218cb1f4d','D'),
('d0e34961-8674-4c56-9929-9380d1e580a7','D'),
('d1187172-6cd3-477a-b035-bbb677d0a62f','F'),
('d14e36cb-8912-4b12-add7-e26357bf832b','D'),
('d27088a8-f517-4281-9f17-7181e2f8d13b','F'),
('d27e6658-0fb0-4ccb-b6a7-4aa9dd64c37d','F'),
('d2880af2-1848-4c39-9311-b9a168cf7474','D'),
('d2a962f7-cdcb-430a-8ea4-8a50323636cb','D'),
('d2ce100a-152e-4b0e-8903-2296a9cb7cbe','D'),
('d311fcf5-37da-49a7-b925-63f316a80355','F'),
('d33a878b-e189-4bd4-aeb8-d9d4acf6cb34','D'),
('d357ecb1-15d0-4553-ad6a-154e9e015f86','D'),
('d364abc6-f070-4608-91f3-f395e877d423','D'),
('d3f422d8-ccab-4ee9-ba50-7678a17ba776','F'),
('d4133457-8650-42b6-ab32-3af289b76d16','F'),
('d49f4819-3a2e-4342-a15a-97edd5abfec5','D'),
('d4c7cab4-cff5-464e-a611-e43011838872','F'),
('d4d3e2b3-1520-4a01-aada-8d6d1b2364b6','D'),
('d5535d14-2abf-49bf-ac62-b5a98ae79c00','F'),
('d6331f8a-49a1-4664-8149-9562b4b7f58e','F'),
('d69e25e8-c1a7-4c38-8a7e-30784cba86c3','F'),
('d6bc0585-d9db-4e0c-8bbc-6ee731fec17c','D'),
('d6cd970a-844a-4531-ae66-479583567335','D'),
('d708c5d2-cccf-4e29-b585-1acc3d145927','F'),
('d712fcf0-3741-461d-9617-8cb68fb1c54c','D'),
('d79b7f91-5f49-4138-8377-71621722400d','F'),
('d7b99137-4394-41e0-909c-5211c5ad1f20','D'),
('d7c8507a-84fc-41d8-9725-d651813bbacb','D'),
('d88dfe5b-9086-40b7-8cc7-d44e23a7a66a','F'),
('d9025f02-260a-4c89-9311-e00b792d35c4','D'),
('d9cb0fc3-1a4d-4cef-8423-65e0edf7adbc','D'),
('dabff589-51fd-4053-9fdc-090345c76729','D'),
('dad82fda-37ca-4a1a-b4c0-8c90dda0b074','F'),
('db345caf-91f1-4f6b-b122-92a10760dea5','D'),
('db36a469-0b7f-4b43-9df9-9a9b4ad492d3','F'),
('db695c4b-1034-4201-afc4-a12af4d1f0f9','F'),
('dbf1c18f-c548-4f9c-8b40-da9b9804bf72','D'),
('dc5fe97a-c175-4ab1-b4e9-54d971cf8385','D'),
('dca6c345-c2ab-456f-98d9-dfbca3a43f7d','F'),
('de07f928-7f81-44c7-80fd-644ee1715649','D'),
('de0fe8e7-d317-43b7-bd5f-82dbac01418a','D'),
('de8cde57-0517-441e-9dad-6541a13b50a1','F'),
('de9802a0-3b0c-4155-abea-31a1a2bac68b','F'),
('dec9ad0a-55c3-4dfe-9ece-5315f9a44544','D'),
('df5726a1-8db1-476f-a763-163ff31cf343','D'),
('df5f9daa-9604-4df7-9249-7e0e5c02585a','D'),
('df9b5404-5652-4331-8a8e-dbff67aedc2d','F'),
('dfa74294-36a3-4dcc-b990-da3a9a510c25','D'),
('dfc642c5-3433-4b88-89ae-74c4e888a618','F'),
('e01eeae8-5c84-49ca-840d-e36c71f1c1e7','D'),
('e02d2c05-eb71-42a5-b078-b7ced84deba0','F'),
('e0a041b8-9e6a-4c50-aee1-81208c3f75e8','D'),
('e0be3976-bb22-4720-829f-791ff19df459','F'),
('e0f03a88-afc3-448f-835a-e8e323d09b57','D'),
('e1af1a0e-98ec-42db-921c-66c19d266766','D'),
('e21f87dd-4cc8-4900-ac3b-8e1946413c79','D'),
('e23ec3e7-72c2-4e2d-85e7-8b902cc6fe33','D'),
('e24c3dca-e63f-4275-a1df-f7d6c6599b6e','D'),
('e2b1ac26-665e-4c44-b866-b9552c902363','D'),
('e2f56804-0cdb-435e-8609-515f0f990767','F'),
('e3aded91-8aa4-4cb8-b5f2-a808b9f1510d','D'),
('e45c02ec-afab-465e-9ab1-c8785582f0a2','F'),
('e4894901-10b8-43cc-b7d9-cb92499c51df','D'),
('e4d609b4-96aa-4159-bc42-988bc762557e','D'),
('e4ea354f-7a17-45c9-b6a7-d9e10e6450f1','D'),
('e5141d4f-e35b-433b-9cf3-6bea40e7ad67','D'),
('e55c9219-b0a6-4431-9669-9dc332583100','D'),
('e573c327-dc89-4d87-81f0-efd0cb3c8020','F'),
('e5769114-c1fe-4980-978d-1f18e85fe65c','F'),
('e5a834e5-bae7-4acd-8be9-a3c995a52395','F'),
('e62b0baa-2ec2-4d24-b979-94ff4fbd34b4','D'),
('e695f6fb-c247-4d9d-9b60-7eb5418cb93d','F'),
('e7096a55-d5bb-4769-aafa-28059f3017d2','F'),
('e7925474-ad31-4cfb-826b-010039bcff3d','F'),
('e8b32dc2-6c5b-407e-ab46-451422d0a6c5','D'),
('e8bdc776-c4f5-49b6-977c-770ecce4a6f0','D'),
('e8cca6bc-24c0-43ac-9b03-58fe82fd59a1','D'),
('e9066be7-3b3b-4778-b27d-d98a09aaf52c','D'),
('e94d80fb-4973-452e-b745-6c3ca68c9b16','F'),
('e96f6e72-57c2-4881-8fb3-6cd29e587b8e','D'),
('ea06617e-0710-4590-b4db-772cd0fa4326','F'),
('ea994444-7a16-435a-9641-fc6b6c837186','D'),
('ea9d8824-5c38-40d4-894d-c1f2398b3a32','F'),
('eae3996f-9f4d-4fad-ae65-7cbd976240c1','F'),
('eaf09a18-9654-4c18-8c5d-48a26ce72259','F'),
('eb2e16b6-8a39-4acc-a644-1c5bf4041b0c','F'),
('eba463f8-2c66-4592-b304-3afc3f7f2c93','D'),
('ecb3637e-e650-4df2-8a63-ccc835c132f5','F'),
('ecd88691-74b9-4574-83d8-b960740a78f5','F'),
('ecf3ca4b-4c70-40bb-8344-366e3cde98ce','D'),
('ed3f0662-8da7-4c24-b8d7-a1000d60cb1f','D'),
('ed8ede33-fd24-4eec-a7d7-3af0478af08c','F'),
('ed8f5032-e632-4df2-9e8f-d705b883149c','D'),
('ed9ff9e2-050f-4145-97a3-0f78d1471710','D'),
('edd28444-0a9a-4eb4-acb1-4136f6d71af2','D'),
('ef1baf0a-72de-4d60-a90f-b9b608b051b3','F'),
('ef25984c-d13a-4e4d-916a-f3537a40ea71','F'),
('ef58b642-df26-41b5-8547-bb279151e844','F'),
('ef5a8ddd-0a68-4ef1-b6f2-4ba9369e0318','F'),
('efa03cea-11a8-454e-ac59-24e59a5d8cc2','F'),
('efe5c57a-4a17-4281-b26d-aa6efe782422','D'),
('f038e893-3568-45a8-81d7-c9b6202b2119','D'),
('f0dbd49e-0991-4f49-8d4a-a715694e96aa','F'),
('f0fd5368-3bac-4930-b0ea-a168dcf8d365','D'),
('f1042170-33c9-4063-b427-910fe1683c72','F'),
('f1090e07-a6c9-4b37-acb5-b4dd4f191ce5','F'),
('f12caf56-c369-4b22-8e04-fdda07820876','F'),
('f140e49c-7104-46fd-9c7f-6b2625a90305','D'),
('f1478ac2-b524-4b56-8ce8-5f8eaef65916','F'),
('f17ad785-2e70-4c7e-b053-50d5e2d93c6e','D'),
('f1889978-7d58-4f41-9d20-54c18231030c','F'),
('f1e78390-98b7-48dd-82b9-a5aadbe95c51','F'),
('f26008f2-8015-42b0-9e5f-3550542e9a09','F'),
('f2e938bf-ce8f-499e-9120-31ad9be6ed6c','D'),
('f352812c-04f0-4720-8746-cf6285951a84','D'),
('f39893fa-6830-49b6-9f80-b32191328ac0','F'),
('f44d72f2-a596-4938-af60-2e36b18de73f','F'),
('f45f73b2-edc0-44d1-9865-1c79bb4d6838','F'),
('f538775f-6f49-4519-8277-adf9176e939c','D'),
('f53f55b8-6bd9-4953-ae64-ff319c524e0f','F'),
('f55bdf9b-aa62-4168-825c-77e0c515f680','D'),
('f60b6e86-e738-47cf-b27c-22fa8e56f660','F'),
('f6371734-a8d5-4902-b4f4-288e817660db','D'),
('f687be6b-fef1-4713-be59-9ed6e8b55eef','F'),
('f69498c4-2af5-49ca-b1de-d9fa0715d57f','D'),
('f69a3498-00d1-4a3b-a31b-04edd9f421e9','F'),
('f7201058-ea88-4c38-89bb-7937f93f50d6','F'),
('f740e628-9097-47cf-91fc-95bbee245792','D'),
('f77a430b-eeb5-4f9e-9d8f-e45a41dc6b7b','D'),
('f77cb4c6-6fc4-45e9-bc6b-7791205391be','F'),
('f7c6e68a-744d-4fe4-bc9e-06996d8341eb','F'),
('f8058099-1f42-4de5-ba90-a27dde896f4a','F'),
('f829c7e3-85e1-4f7b-83d8-7f7b2e11d2ee','F'),
('f83a8613-1969-402b-81a4-05ae7f164bb4','F'),
('f847d6ec-06ba-4268-b6d0-5ec070143750','F'),
('f84fc8f2-6a0d-4702-a120-c0e5225fb57e','D'),
('f86105e2-d694-4c7c-897e-3f0a9ee34511','D'),
('f89ffdd0-33c1-4f3f-bf4a-12e34186437d','D'),
('f8c8eb13-14a0-4478-8771-7d29e71036ca','D'),
('f9a23390-1b4a-4ee3-bf08-84679cd28596','D'),
('f9c17977-bae4-495a-b014-eb4f6297a565','D'),
('f9d1432c-db72-4d02-90be-714269f1111f','F'),
('f9e96cd6-c8b8-4ddc-aea8-a6a81155158a','D'),
('fa1e5089-ef7a-44e4-8aed-1e55dfa36784','D'),
('fb5fe9fe-2fe9-4970-b152-f08871ffec61','D'),
('fb7c947d-79ce-4706-8c33-bb4f39359c59','F'),
('fb7da841-7258-45a6-90a5-3ec623b1297c','D'),
('fb825ba4-09a8-44c6-a719-13c682893e04','F'),
('fc399144-95d5-40f6-9a71-ccdeaa4d4bd9','F'),
('fc82ea80-c4cd-48d8-b8c5-43c01e38140c','D'),
('fc9fa68f-394c-440e-a311-1cb93e2ab5f3','F'),
('fca1720a-eb02-4284-831f-2bd4ba21f04b','F'),
('fcd210bb-6685-46a9-bbf2-a137697e83dc','D'),
('fd1b5e7e-3dfc-40d2-890f-23b936ac24ab','D'),
('fde6904f-a91b-4242-9876-cbac4828f5f8','D'),
('fdf075f5-e450-4099-a043-691377b0ae64','D'),
('fe61e2a8-54e5-4e6d-898a-8dde5aaaa5c3','D'),
('fea3b7af-c515-4773-a9e8-11ed5de7ba5f','D'),
('fec0b77f-cb72-4aaf-b805-2253f4f3be6c','F'),
('ff384f76-989b-4813-aa2c-2ccaed833d42','D'),
('ffa11ad2-d258-4171-b05a-1956276a39bf','F'),
('ffb2b4fc-3479-4f0d-a720-84184b189bdf','F')
  ) AS v(h, k);

DO $manifest$
DECLARE v_sha text; v_d int; v_f int; v_missing int; v_extra int;
BEGIN
 SELECT encode(sha256(convert_to(string_agg(a.horse_id::text || ':' ||
          CASE WHEN a.club_id='2a1132b9-5ba2-42e6-9f01-30a7fcffebe3' THEN 'D' ELSE 'F' END,
          E'\n' ORDER BY a.horse_id::text), 'UTF8')), 'hex'),
        count(*) FILTER (WHERE a.club_id='2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'),
        count(*) FILTER (WHERE a.club_id='a0000000-0000-0000-0000-000000000001')
   INTO v_sha, v_d, v_f FROM public.ca_horse_club_assignments a;
 IF v_sha IS DISTINCT FROM '22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270' THEN
  RAISE EXCEPTION 'horse_club_manifest_hash_mismatch %', v_sha; END IF;
 IF v_d <> 500 OR v_f <> 500 THEN RAISE EXCEPTION 'horse_club_manifest_counts % %', v_d, v_f; END IF;
 SELECT count(*) INTO v_missing FROM public.ca_horse_club_assignments a
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=a.horse_id AND coalesce(p.is_horse,false));
 IF v_missing <> 0 THEN RAISE EXCEPTION 'horse_club_manifest_names_non_horses %', v_missing; END IF;
 SELECT count(*) INTO v_extra FROM public.ca_horse_fleet_register r
  WHERE r.retired_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.ca_horse_club_assignments a WHERE a.horse_id=r.horse_id);
 IF v_extra <> 0 THEN RAISE EXCEPTION 'horse_club_manifest_misses_canonical_horses %', v_extra; END IF;
END
$manifest$;

-- 2. ADMISSION ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_horse_split_phase()
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce((SELECT s.phase FROM public.ca_horse_club_split_state s WHERE s.singleton), 'inactive');
$$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_assigned_club(p_horse uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT a.club_id FROM public.ca_horse_club_assignments a WHERE a.horse_id = p_horse;
$$;

-- NULL means admitted. p_host is the club that hosts the row (membership club,
-- table club, tournament club). p_wallet is the club the row is funded from,
-- when known. Only called for horses.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_refusal(p_horse uuid, p_host uuid, p_wallet uuid, p_membership boolean)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_phase text := public.fn_ca_horse_split_phase(); v_home uuid;
BEGIN
  IF v_phase = 'inactive' THEN RETURN NULL; END IF;
  IF v_phase IN ('draining','executing') THEN
    -- The operation itself writes memberships (departures) under its own flag.
    IF coalesce(current_setting('app.horse_club_split_operation', true), '') <> '' THEN RETURN NULL; END IF;
    RETURN 'HORSE_CLUB_SPLIT_IN_PROGRESS: Horses Are Paused While Their Clubs Are Reassigned';
  END IF;
  v_home := public.fn_ca_horse_assigned_club(p_horse);
  IF v_home IS NULL THEN
    RETURN 'HORSE_HAS_NO_ASSIGNED_CLUB: This Horse Is Not On The Club Manifest';
  END IF;
  IF p_host = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid THEN
    RETURN 'HORSE_NOT_ADMITTED_TO_KINGS_CLUB: Kings Club Has No Horses';
  END IF;
  IF p_membership THEN
    IF p_host IS DISTINCT FROM v_home THEN
      RETURN 'HORSE_ONE_CLUB_ONLY: A Horse Belongs Only To Its Assigned Club';
    END IF;
  ELSIF p_host IS DISTINCT FROM v_home
     AND NOT EXISTS (SELECT 1 FROM public.clubs u
                       JOIN public.union_clubs uc ON uc.union_id = u.union_id AND uc.club_id = v_home
                      WHERE u.id = p_host AND coalesce(u.is_union, false)) THEN
    RETURN 'HORSE_ONE_CLUB_ONLY: A Horse Plays Only In Its Assigned Club Or Its Union';
  END IF;
  IF p_wallet IS NOT NULL AND p_wallet IS DISTINCT FROM v_home THEN
    RETURN 'HORSE_ONE_CLUB_ONLY: A Horse Is Funded Only From Its Assigned Club';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_reject_automated_user_club_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id uuid;
  v_user_id uuid;
  v_automated boolean := false;
  v_is_horse boolean := false;
  v_refusal text;
BEGIN
  IF TG_TABLE_NAME = 'club_members' THEN
    v_club_id := NEW.club_id;
    v_user_id := NEW.user_id;
    v_automated := COALESCE(NEW.is_bot, false);
  ELSIF TG_TABLE_NAME = 'agents' THEN
    v_club_id := NEW.club_id;
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'table_seats' THEN
    -- A historical/departed seat remains immutable evidence. Only a live seat
    -- can put an automated player back onto a user-created club table.
    IF NEW.left_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT t.club_id INTO v_club_id FROM public.tables t WHERE t.id = NEW.table_id;
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'tournament_players' THEN
    SELECT t.club_id INTO v_club_id
      FROM public.tournaments t WHERE t.id = NEW.tournament_id;
    v_user_id := NEW.user_id;
  ELSE
    RAISE EXCEPTION 'Unsupported Automated-Club Guard Table: %', TG_TABLE_NAME;
  END IF;

  v_is_horse := COALESCE(
    (SELECT p.is_horse FROM public.profiles p WHERE p.id = v_user_id), false
  );
  v_automated := v_automated OR v_is_horse;

  IF v_automated AND NOT public.fn_ca_house_board_allows_automation(v_club_id) THEN
    RAISE EXCEPTION 'AUTOMATED_PLAYER_HOUSE_BOARD_ONLY: Automated Players Cannot Enter A User-Created Club'
      USING ERRCODE = '42501';
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229). Agents rows follow
  -- their membership; a departed membership update (lifecycle) is judged by
  -- fn_guard_membership_lifecycle_write instead.
  IF v_is_horse AND TG_TABLE_NAME <> 'agents' THEN
    v_refusal := public.fn_ca_horse_club_refusal(
      v_user_id, v_club_id,
      CASE WHEN TG_TABLE_NAME = 'tournament_players' THEN NEW.club_id END,
      TG_TABLE_NAME = 'club_members');
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_stamp_seat_club()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_refusal text;
BEGIN
  -- A SEAT KEEPS THE CLUB IT WAS SEATED UNDER (2026-09-10). Nothing that the
  -- stamp is derived from changed, and the seat already carries a club, so
  -- there is nothing to derive. This was 6.0 ms of club_members lookups on
  -- every stack write; see the migration header.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id
     AND NEW.club_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT NULL AND NEW.table_id IS NOT NULL THEN
    NEW.club_id := COALESCE(
      public.fn_seat_club_for_user(NEW.user_id, NEW.table_id, NEW.club_id),
      NEW.club_id
    );
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229): a live horse seat is
  -- funded only from the horse's assigned club, whatever routed it here.
  IF NEW.left_at IS NULL AND NEW.user_id IS NOT NULL
     AND public.fn_ca_horse_split_phase() <> 'inactive'
     AND COALESCE((SELECT p.is_horse FROM public.profiles p WHERE p.id = NEW.user_id), false) THEN
    v_refusal := public.fn_ca_horse_club_refusal(
      NEW.user_id, (SELECT t.club_id FROM public.tables t WHERE t.id = NEW.table_id), NEW.club_id, false);
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_membership_lifecycle_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_allowed boolean := coalesce(
    current_setting('app.club_membership_lifecycle_write', true), ''
  ) IN ('depart', 'rejoin');
  v_refusal text;
BEGIN
  IF OLD.membership_lifecycle_status = 'departed' AND NOT v_allowed
     AND NOT (public.fn_caller_is_engine() IS TRUE
       AND (to_jsonb(NEW) - ARRAY['chip_balance','updated_at'])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['chip_balance','updated_at'])) THEN
    RAISE EXCEPTION 'MEMBERSHIP_DEPARTED: use the Join Club workflow to return'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.membership_lifecycle_status, NEW.departed_at, NEW.departed_by, NEW.departure_reason)
       IS DISTINCT FROM
     (OLD.membership_lifecycle_status, OLD.departed_at, OLD.departed_by, OLD.departure_reason)
     AND NOT v_allowed THEN
    RAISE EXCEPTION 'MEMBERSHIP_LIFECYCLE_REQUIRES_RPC'
      USING ERRCODE = '42501';
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229): a horse never
  -- returns to a club it is not assigned to.
  IF OLD.membership_lifecycle_status = 'departed'
     AND NEW.membership_lifecycle_status IS DISTINCT FROM 'departed'
     AND COALESCE(NEW.is_bot, false)
     AND COALESCE((SELECT p.is_horse FROM public.profiles p WHERE p.id = NEW.user_id), false) THEN
    v_refusal := public.fn_ca_horse_club_refusal(NEW.user_id, NEW.club_id, NULL, true);
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

-- 3. THE OPERATION -----------------------------------------------------------
-- Deterministic op keys: a replay of any leg collides with the existing
-- chip_transactions unique indexes and with this operation's receipt rows.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_split_op_key(p_op uuid, p_kind text, p_club uuid, p_horse uuid)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('horse-club-split:' || p_op::text || ':' || p_kind || ':' || p_club::text || ':' || coalesce(p_horse::text, '-'))::uuid;
$$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_split_preflight()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_week_end timestamptz := '2026-11-02 08:00:00+00';
  v_n bigint;
  v_owed jsonb;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;

  -- The week's rakeback must be paid first, and nothing of it still owed.
  IF NOT EXISTS (SELECT 1 FROM public.weekly_accounting_payout_pauses p
                  WHERE p.period_end = v_week_end AND p.phase = 'released'
                    AND coalesce(p.result->>'success','') = 'true') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','weekly_payout_not_released','period_end',v_week_end));
  END IF;
  BEGIN
    v_owed := smarter_private.weekly_payout_scope_plan(v_week_end, now());
  EXCEPTION WHEN OTHERS THEN
    v_owed := jsonb_build_array(jsonb_build_object('error', SQLERRM));
  END;
  IF jsonb_array_length(coalesce(v_owed,'[]'::jsonb)) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','weekly_payout_scopes_still_owed','owed',v_owed));
  END IF;

  IF EXISTS (SELECT 1 FROM public.ca_horse_fleet_policy f WHERE f.scope='global' AND coalesce(f.enabled,true)) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_fleet_enabled'));
  END IF;

  SELECT count(*) INTO v_n FROM public.table_seats ts JOIN public.profiles p ON p.id=ts.user_id AND p.is_horse
   WHERE ts.left_at IS NULL;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_live_seats','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.tournament_players tp JOIN public.profiles p ON p.id=tp.user_id AND p.is_horse
    JOIN public.tournaments t ON t.id=tp.tournament_id
   WHERE lower(coalesce(tp.status::text,'')) IN ('registered','playing')
     AND upper(coalesce(t.status::text,'')) NOT IN ('COMPLETED','CANCELLED');
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_tournament_custody','entries',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.cashout_requests cr JOIN public.profiles p ON p.id=cr.player_id AND p.is_horse
   WHERE cr.status IN ('pending','approved');
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_cashouts','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.chip_escrow_holds h JOIN public.profiles p ON p.id=h.user_id AND p.is_horse
   WHERE h.status='held';
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_escrow','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.tournament_tickets tt JOIN public.profiles p ON p.id=tt.holder_id AND p.is_horse
   WHERE tt.status='issued';
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_tickets','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.club_members cm JOIN public.profiles p ON p.id=cm.user_id AND p.is_horse
   WHERE abs(coalesce(cm.held_chips,0))+abs(coalesce(cm.locked_chips,0))+abs(coalesce(cm.promo_balance,0))
        +abs(coalesce(cm.credit_used,0))+abs(coalesce(cm.diamonds,0)) <> 0;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_unreconciled_member_balances','count',v_n)); END IF;

  SELECT count(*) INTO v_n FROM public.agents a JOIN public.profiles p ON p.id=a.user_id AND p.is_horse
   WHERE abs(coalesce(a.player_wallet_balance,0))+abs(coalesce(a.player_balance,0))+abs(coalesce(a.promo_balance,0))
        +abs(coalesce(a.credit_used,0)) <> 0;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('blocker','horse_unreconciled_agent_balances','count',v_n)); END IF;

  RETURN jsonb_build_object('ready', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers,
    'phase', public.fn_ca_horse_split_phase(), 'checked_at', clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_split_begin_drain(p_operation uuid, p_operator text, p_mint_cap numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_operation IS NULL OR coalesce(btrim(p_operator),'') = '' OR p_mint_cap IS NULL OR p_mint_cap < 0 THEN
    RAISE EXCEPTION 'horse_club_split_arguments_required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.ca_horse_club_split_state WHERE singleton FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_operations o WHERE o.operation_id <> p_operation) THEN
    RAISE EXCEPTION 'horse_club_split_already_has_an_operation' USING ERRCODE='55000'; END IF;
  INSERT INTO public.ca_horse_club_split_operations(operation_id, manifest_version, operator_label, mint_cap)
  VALUES (p_operation, 'horse-club-split-20261102', p_operator, p_mint_cap)
  ON CONFLICT (operation_id) DO NOTHING;
  UPDATE public.ca_horse_club_split_state
     SET phase = 'draining', operation_id = p_operation, changed_at = clock_timestamp()
   WHERE singleton AND phase = 'inactive';
  RETURN jsonb_build_object('operation_id', p_operation, 'phase', public.fn_ca_horse_split_phase());
END $$;

-- One wallet leg, journaled exactly as the Club Bank claim/send doors journal it.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_split_wallet_leg(
  p_op uuid, p_kind text, p_club uuid, p_horse uuid, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_key uuid := public.fn_ca_horse_split_op_key(p_op, p_kind, p_club, p_horse);
  v_bank_before numeric; v_bank_after numeric; v_before numeric; v_after numeric; v_agent uuid;
  v_type text; v_reason text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts r
              WHERE r.operation_id = p_op AND r.horse_id = p_horse AND r.club_id = p_club AND r.kind = p_kind) THEN
    RETURN jsonb_build_object('replayed', true);
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('skipped', true); END IF;

  SELECT coalesce(c.chip_treasury,0) INTO v_bank_before FROM public.clubs c WHERE c.id = p_club FOR UPDATE;
  IF v_bank_before IS NULL THEN RAISE EXCEPTION 'horse_split_club_missing %', p_club; END IF;

  IF p_kind = 'player_wallet_claim' THEN
    v_type := 'club_bank_claim'; v_reason := 'Horse Club Split: Wallet Returned To The Club Bank (Dan, 2026-11-02)';
    SELECT coalesce(cm.chip_balance,0) INTO v_before FROM public.club_members cm
     WHERE cm.club_id = p_club AND cm.user_id = p_horse FOR UPDATE;
    IF v_before < p_amount THEN RAISE EXCEPTION 'horse_split_wallet_short % % % %', p_club, p_horse, v_before, p_amount; END IF;
    PERFORM public.fn_ca_declare_ledger('club_bank_claim', 'club_treasury', p_club, NULL,
      'club_bank_claim:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    UPDATE public.club_members SET chip_balance = coalesce(chip_balance,0) - p_amount, updated_at = now()
     WHERE club_id = p_club AND user_id = p_horse RETURNING chip_balance INTO v_after;
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury,0) + p_amount, updated_at = now()
     WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
  ELSIF p_kind = 'agent_wallet_claim' THEN
    v_type := 'club_bank_claim'; v_reason := 'Horse Club Split: Agent Wallet Returned To The Club Bank (Dan, 2026-11-02)';
    SELECT a.id, coalesce(a.agent_wallet_balance,0) INTO v_agent, v_before FROM public.agents a
     WHERE a.club_id = p_club AND a.user_id = p_horse FOR UPDATE;
    IF v_agent IS NULL OR v_before < p_amount THEN RAISE EXCEPTION 'horse_split_agent_wallet_short % %', p_club, p_horse; END IF;
    PERFORM public.fn_ca_declare_ledger('club_bank_claim', 'club_treasury', p_club, NULL,
      'club_bank_claim:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    UPDATE public.agents SET agent_wallet_balance = coalesce(agent_wallet_balance,0) - p_amount, updated_at = now()
     WHERE id = v_agent RETURNING agent_wallet_balance INTO v_after;
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury,0) + p_amount, updated_at = now()
     WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
  ELSIF p_kind = 'fund_10000' THEN
    v_type := 'club_bank_send'; v_reason := 'Horse Club Split: Restart At 10,000 (Dan, 2026-11-02)';
    IF v_bank_before < p_amount THEN RAISE EXCEPTION 'horse_split_bank_short % % %', p_club, v_bank_before, p_amount; END IF;
    SELECT coalesce(cm.chip_balance,0) INTO v_before FROM public.club_members cm
     WHERE cm.club_id = p_club AND cm.user_id = p_horse FOR UPDATE;
    PERFORM public.fn_ca_declare_ledger('club_bank_send', 'club_treasury', p_club, NULL,
      'club_bank_send:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury,0) - p_amount, updated_at = now()
     WHERE id = p_club RETURNING chip_treasury INTO v_bank_after;
    UPDATE public.club_members SET chip_balance = coalesce(chip_balance,0) + p_amount, updated_at = now()
     WHERE club_id = p_club AND user_id = p_horse RETURNING chip_balance INTO v_after;
  ELSE
    RAISE EXCEPTION 'horse_split_unknown_leg %', p_kind;
  END IF;
  PERFORM set_config('app.ledger_autoskip_clubs', '', true);

  INSERT INTO public.chip_transactions(club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
  VALUES (p_club,
          CASE WHEN v_type = 'club_bank_claim' THEN p_horse END,
          CASE WHEN v_type = 'club_bank_send' THEN p_horse END,
          p_amount, v_type, v_reason,
          jsonb_build_object('op_id', v_key, 'operation', 'horse-club-split-20261102', 'operation_id', p_op,
            'leg', p_kind, 'actor', 'horse_club_split_operation',
            'source', CASE WHEN p_kind='agent_wallet_claim' THEN 'agent_wallet' WHEN p_kind='player_wallet_claim' THEN 'player_wallet' ELSE 'club_bank' END,
            'destination', CASE WHEN v_type='club_bank_send' THEN 'player_wallet' ELSE 'club_bank' END,
            'bank_before', v_bank_before, 'bank_after', v_bank_after,
            'holder_balance_before', v_before, 'holder_balance_after', v_after),
          v_bank_after);

  INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, amount,
    wallet_before, wallet_after, bank_before, bank_after, op_key)
  VALUES (p_op, p_horse, p_club, p_kind, p_amount, v_before, v_after, v_bank_before, v_bank_after, v_key);
  RETURN jsonb_build_object('amount', p_amount, 'bank_after', v_bank_after, 'wallet_after', v_after);
END $$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_club_split_execute(p_operation uuid, p_max_rows integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  c_dss constant uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
  c_felt constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_kings constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  v_op public.ca_horse_club_split_operations%ROWTYPE;
  v_pre jsonb; r record; v_done integer := 0; v_need numeric; v_have numeric; v_short numeric;
  v_mint jsonb; v_summary jsonb; v_changed integer; v_minted numeric := 0;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_op FROM public.ca_horse_club_split_operations WHERE operation_id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'horse_club_split_unknown_operation' USING ERRCODE='22023'; END IF;
  IF v_op.stage = 'complete' THEN RETURN jsonb_build_object('stage','complete','replayed',true,'summary',v_op.summary); END IF;
  PERFORM set_config('app.horse_club_split_operation', p_operation::text, true);

  IF v_op.stage = 'draining' THEN
    v_pre := public.fn_ca_horse_club_split_preflight();
    UPDATE public.ca_horse_club_split_operations SET preflight = v_pre WHERE operation_id = p_operation;
    IF NOT (v_pre->>'ready')::boolean THEN
      RETURN jsonb_build_object('stage','draining','advanced',false,'preflight',v_pre);
    END IF;
    UPDATE public.ca_horse_club_split_state SET phase='executing', changed_at=clock_timestamp() WHERE singleton;
    UPDATE public.ca_horse_club_split_operations SET stage='sweeping' WHERE operation_id = p_operation;
    v_op.stage := 'sweeping';
  END IF;

  IF v_op.stage = 'sweeping' THEN
    -- Every horse membership row: claim the player wallet into ITS club's bank;
    -- in a club the horse leaves, also claim the agent wallet and depart it.
    FOR r IN
      SELECT cm.club_id, cm.user_id AS horse_id, coalesce(cm.chip_balance,0) AS wallet,
             public.fn_ca_horse_assigned_club(cm.user_id) AS home,
             cm.membership_lifecycle_status AS lifecycle,
             (SELECT coalesce(a.agent_wallet_balance,0) FROM public.agents a
               WHERE a.club_id = cm.club_id AND a.user_id = cm.user_id) AS agent_wallet
        FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
       WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts x
                          WHERE x.operation_id = p_operation AND x.horse_id = cm.user_id AND x.club_id = cm.club_id
                            AND x.kind IN ('departed','player_wallet_claim'))
         AND (coalesce(cm.chip_balance,0) > 0
              OR (cm.membership_lifecycle_status = 'active'
                  AND cm.club_id IS DISTINCT FROM public.fn_ca_horse_assigned_club(cm.user_id)))
       ORDER BY cm.club_id, cm.user_id
       LIMIT p_max_rows
    LOOP
      IF r.wallet > 0 THEN
        PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'player_wallet_claim', r.club_id, r.horse_id, r.wallet);
      END IF;
      IF r.club_id IS DISTINCT FROM r.home AND r.lifecycle = 'active' THEN
        IF coalesce(r.agent_wallet,0) > 0 THEN
          PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'agent_wallet_claim', r.club_id, r.horse_id, r.agent_wallet);
        END IF;
        -- Horses below a departing horse agent go direct to the club.
        WITH released AS (
          UPDATE public.club_members d
             SET agent_id = CASE WHEN d.agent_id = r.horse_id THEN NULL ELSE d.agent_id END,
                 parent_agent_id = CASE WHEN d.parent_agent_id = r.horse_id THEN NULL ELSE d.parent_agent_id END,
                 updated_at = clock_timestamp()
           WHERE d.club_id = r.club_id AND d.user_id <> r.horse_id
             AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)
             AND EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = d.user_id AND hp.is_horse)
          RETURNING d.user_id)
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        SELECT p_operation, x.user_id, r.club_id, 'downline_released', jsonb_build_object('former_agent', r.horse_id)
          FROM released x
        ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
        IF EXISTS (SELECT 1 FROM public.club_members d JOIN public.profiles hp ON hp.id = d.user_id AND NOT coalesce(hp.is_horse,false)
                    WHERE d.club_id = r.club_id AND (d.agent_id = r.horse_id OR d.parent_agent_id = r.horse_id)) THEN
          RAISE EXCEPTION 'horse_split_human_downline % %', r.club_id, r.horse_id;
        END IF;
        UPDATE public.agents SET status = 'suspended', updated_at = clock_timestamp()
         WHERE club_id = r.club_id AND user_id = r.horse_id AND status IS DISTINCT FROM 'suspended';
        PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
        UPDATE public.club_members cm
           SET status = 'suspended', is_active = false, membership_lifecycle_status = 'departed',
               departed_at = clock_timestamp(), departed_by = NULL,
               departure_reason = 'Horse Club Split (Dan, 2026-11-02)', updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id AND cm.membership_lifecycle_status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
        IF v_changed <> 1 THEN RAISE EXCEPTION 'horse_split_membership_changed % %', r.club_id, r.horse_id; END IF;
        INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
        VALUES (p_operation, r.horse_id, r.club_id, 'departed', jsonb_build_object('assigned_club', r.home));
      END IF;
      v_done := v_done + 1;
    END LOOP;
    IF v_done >= p_max_rows THEN
      RETURN jsonb_build_object('stage','sweeping','advanced',true,'rows',v_done,'more',true);
    END IF;
    -- A manifest horse without an active membership in its assigned club joins
    -- it now (22 on 2026-11-02: 18 Felt-only horses moved to Deep Stack and 4
    -- held no Deep Stack or Felt membership). Same source the join door uses;
    -- a horse membership starts at zero and is funded below.
    FOR r IN SELECT a.horse_id, a.club_id,
                    (SELECT cm.membership_lifecycle_status FROM public.club_members cm
                      WHERE cm.user_id = a.horse_id AND cm.club_id = a.club_id) AS lifecycle
               FROM public.ca_horse_club_assignments a
              WHERE NOT EXISTS (SELECT 1 FROM public.club_members cm
                                 WHERE cm.user_id = a.horse_id AND cm.club_id = a.club_id
                                   AND cm.membership_lifecycle_status = 'active'
                                   AND coalesce(cm.status,'active') IN ('active','approved')) LOOP
      IF r.lifecycle IS NULL THEN
        PERFORM set_config('app.club_membership_source', 'join_club', true);
        INSERT INTO public.club_members(club_id, user_id, role, status, is_active, is_bot, chip_balance, membership_lifecycle_status)
        VALUES (r.club_id, r.horse_id, 'player', 'active', true, true, 0, 'active');
        PERFORM set_config('app.club_membership_source', '', true);
      ELSE
        PERFORM set_config('app.club_membership_lifecycle_write', 'rejoin', true);
        UPDATE public.club_members cm
           SET status = 'active', is_active = true, membership_lifecycle_status = 'active',
               departed_at = NULL, departed_by = NULL, departure_reason = NULL, updated_at = clock_timestamp()
         WHERE cm.club_id = r.club_id AND cm.user_id = r.horse_id;
        PERFORM set_config('app.club_membership_lifecycle_write', '', true);
      END IF;
      INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, detail)
      VALUES (p_operation, r.horse_id, r.club_id, 'joined', jsonb_build_object('previous_lifecycle', r.lifecycle))
      ON CONFLICT (operation_id, horse_id, club_id, kind) DO NOTHING;
    END LOOP;
    UPDATE public.ca_horse_club_split_operations SET stage='minting' WHERE operation_id = p_operation;
    v_op.stage := 'minting';
  END IF;

  IF v_op.stage = 'minting' THEN
    FOR r IN SELECT x.club_id, count(*) AS horses FROM public.ca_horse_club_assignments x GROUP BY x.club_id LOOP
      IF EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts m
                  WHERE m.operation_id = p_operation AND m.club_id = r.club_id AND m.kind = 'mint') THEN CONTINUE; END IF;
      v_need := r.horses * 10000 - coalesce((SELECT sum(f.amount) FROM public.ca_horse_club_split_receipts f
                  WHERE f.operation_id = p_operation AND f.club_id = r.club_id AND f.kind = 'fund_10000'), 0);
      SELECT coalesce(c.chip_treasury,0) INTO v_have FROM public.clubs c WHERE c.id = r.club_id FOR UPDATE;
      v_short := greatest(0, v_need - v_have);
      IF v_short > 0 THEN
        IF v_minted + v_short > v_op.mint_cap THEN
          RAISE EXCEPTION 'horse_split_mint_exceeds_authorized_cap club % short % cap %', r.club_id, v_short, v_op.mint_cap;
        END IF;
        -- The Mint takes only the service identity; this body is reachable only
        -- by a trusted caller (fn_caller_is_engine above).
        PERFORM set_config('request.jwt.claim.role', 'service_role', true);
        v_mint := public.fn_ca_mint('chips', 'club', r.club_id, round(v_short, 2),
          'Horse Club Split: Shortfall To Restart Every Assigned Horse At 10,000 (Dan, 2026-11-02)',
          'horse-club-split:' || p_operation::text || ':mint:' || r.club_id::text, 'admin');
        IF coalesce((v_mint->>'ok')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'horse_split_mint_refused %', v_mint;
        END IF;
        v_minted := v_minted + v_short;
      END IF;
      INSERT INTO public.ca_horse_club_split_receipts(operation_id, horse_id, club_id, kind, amount, bank_before, bank_after, detail)
      VALUES (p_operation, NULL, r.club_id, 'mint', v_short, v_have, v_have + v_short,
              jsonb_build_object('needed', v_need, 'mint', coalesce(v_mint, '{}'::jsonb)));
    END LOOP;
    UPDATE public.ca_horse_club_split_operations SET stage='funding' WHERE operation_id = p_operation;
    v_op.stage := 'funding';
  END IF;

  IF v_op.stage = 'funding' THEN
    v_done := 0;
    FOR r IN SELECT a.horse_id, a.club_id, coalesce(cm.chip_balance,0) AS wallet
               FROM public.ca_horse_club_assignments a
               JOIN public.club_members cm ON cm.user_id = a.horse_id AND cm.club_id = a.club_id
              WHERE NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts f
                                 WHERE f.operation_id = p_operation AND f.horse_id = a.horse_id
                                   AND f.club_id = a.club_id AND f.kind = 'fund_10000')
              ORDER BY a.club_id, a.horse_id LIMIT p_max_rows LOOP
      IF r.wallet <> 0 THEN RAISE EXCEPTION 'horse_split_wallet_not_empty_before_funding % %', r.horse_id, r.wallet; END IF;
      PERFORM public.fn_ca_horse_split_wallet_leg(p_operation, 'fund_10000', r.club_id, r.horse_id, 10000);
      v_done := v_done + 1;
    END LOOP;
    IF v_done >= p_max_rows THEN
      RETURN jsonb_build_object('stage','funding','advanced',true,'rows',v_done,'more',true);
    END IF;
    UPDATE public.ca_horse_club_split_operations SET stage='enforcing' WHERE operation_id = p_operation;
    v_op.stage := 'enforcing';
  END IF;

  IF v_op.stage = 'enforcing' THEN
    SELECT jsonb_build_object(
      'deep_stack', count(*) FILTER (WHERE cm.club_id = c_dss),
      'felt', count(*) FILTER (WHERE cm.club_id = c_felt),
      'kings', count(*) FILTER (WHERE cm.club_id = c_kings),
      'other_active_horse_memberships', count(*) FILTER (WHERE cm.club_id NOT IN (c_dss, c_felt)),
      'wallets_not_10000', count(*) FILTER (WHERE cm.club_id IN (c_dss, c_felt) AND cm.chip_balance <> 10000))
      INTO v_summary
      FROM public.club_members cm JOIN public.profiles p ON p.id = cm.user_id AND p.is_horse
     WHERE cm.membership_lifecycle_status = 'active';
    IF (v_summary->>'deep_stack')::int <> 500 OR (v_summary->>'felt')::int <> 500
       OR (v_summary->>'kings')::int <> 0 OR (v_summary->>'other_active_horse_memberships')::int <> 0
       OR (v_summary->>'wallets_not_10000')::int <> 0 THEN
      RAISE EXCEPTION 'horse_split_final_state_wrong %', v_summary;
    END IF;
    v_summary := v_summary || jsonb_build_object(
      'minted', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='mint'),
      'claimed_player', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='player_wallet_claim'),
      'claimed_agent', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='agent_wallet_claim'),
      'funded', (SELECT coalesce(sum(amount),0) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='fund_10000'),
      'departed', (SELECT count(*) FROM public.ca_horse_club_split_receipts WHERE operation_id=p_operation AND kind='departed'),
      'manifest_sha256', '22af823bbec6a2dc108fa0ebdc1063589e095abfba095d85d08f762325a0c270');
    UPDATE public.ca_horse_club_split_state SET phase='enforcing', changed_at=clock_timestamp() WHERE singleton;
    UPDATE public.ca_horse_club_split_operations
       SET stage='complete', completed_at=clock_timestamp(), summary=v_summary WHERE operation_id = p_operation;
    RETURN jsonb_build_object('stage','complete','summary',v_summary);
  END IF;
  RETURN jsonb_build_object('stage', v_op.stage);
END $$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_preflight() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_begin_drain(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_split_wallet_leg(uuid, text, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_club_split_execute(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_split_op_key(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_club_refusal(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- 4. KINGS CLUB DISPLAY ------------------------------------------------------
CREATE TABLE public.club_display_labeled_additions (
  club_id uuid PRIMARY KEY,
  member_addition integer NOT NULL DEFAULT 0 CHECK (member_addition >= 0),
  active_addition integer NOT NULL DEFAULT 0 CHECK (active_addition >= 0),
  label text NOT NULL,
  reason text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_display_labeled_additions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_display_labeled_additions FROM PUBLIC, anon, authenticated;
INSERT INTO public.club_display_labeled_additions(club_id, member_addition, active_addition, label, reason)
VALUES ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', 1500, 233, 'Bonus',
        'Dan 2026-11-02: Kings Club shows +1,500 members and +233 active as a separately labelled addition; the real counts stay real.');

CREATE OR REPLACE FUNCTION public.fn_club_display_labeled_additions(p_club_ids uuid[])
RETURNS TABLE (club_id uuid, member_addition integer, active_addition integer, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT a.club_id, a.member_addition, a.active_addition, a.label
    FROM public.club_display_labeled_additions a
   WHERE a.club_id = ANY (coalesce(p_club_ids, '{}'::uuid[]));
$$;
REVOKE ALL ON FUNCTION public.fn_club_display_labeled_additions(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_club_display_labeled_additions(uuid[]) TO anon, authenticated, service_role;

-- The blended boost made Kings' member count read higher than its members.
UPDATE public.club_display_member_boost
   SET boost = 0, reason = coalesce(reason,'') || ' | 2026-11-02: Kings Club shows real counts; additions are labelled separately.', set_at = now()
 WHERE club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';

-- 5. KINGS CLUB FLEET POLICY --------------------------------------------------
INSERT INTO public.ca_horse_fleet_policy(scope, scope_id, enabled, pause_new_seatings, notes)
VALUES ('club', 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4', false, true,
        'Dan 2026-11-02: KINGS CLUB has zero horses playing in it.')
ON CONFLICT (scope, scope_key) DO UPDATE SET enabled = false, pause_new_seatings = true,
  notes = EXCLUDED.notes, updated_at = now();

DO $post$
BEGIN
 IF position('HORSES BELONG TO ONE ASSIGNED CLUB' IN pg_get_functiondef('public.fn_ca_reject_automated_user_club_row()'::regprocedure)) = 0
  OR position('HORSES BELONG TO ONE ASSIGNED CLUB' IN pg_get_functiondef('public.fn_stamp_seat_club()'::regprocedure)) = 0
  OR position('HORSES BELONG TO ONE ASSIGNED CLUB' IN pg_get_functiondef('public.fn_guard_membership_lifecycle_write()'::regprocedure)) = 0 THEN
  RAISE EXCEPTION 'horse_club_enforcement_missing'; END IF;
 IF public.fn_ca_horse_split_phase() <> 'inactive' THEN RAISE EXCEPTION 'horse_club_split_must_install_inactive'; END IF;
 IF has_function_privilege('anon','public.fn_ca_horse_club_split_execute(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_ca_horse_club_split_execute(uuid,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'horse_club_split_reachable_without_account'; END IF;
END
$post$;
COMMIT;
