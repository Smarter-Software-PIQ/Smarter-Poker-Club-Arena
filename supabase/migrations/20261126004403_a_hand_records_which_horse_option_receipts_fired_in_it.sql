-- 20261126004403_a_hand_records_which_horse_option_receipts_fired_in_it.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT relrowsecurity FROM pg_class WHERE oid='public.ca_horse_hand_receipts'::regclass) AND has_table_privilege('service_role','public.ca_horse_hand_receipts','INSERT') AND has_table_privilege('service_role','public.ca_horse_hand_receipts','SELECT') AND NOT has_table_privilege('service_role','public.ca_horse_hand_receipts','UPDATE') AND NOT has_table_privilege('service_role','public.ca_horse_hand_receipts','DELETE') AND NOT has_table_privilege('anon','public.ca_horse_hand_receipts','SELECT') AND NOT has_table_privilege('authenticated','public.ca_horse_hand_receipts','SELECT') AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.ca_horse_hand_receipts'::regclass) AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ca_horse_hand_receipts'::regclass AND contype='f') AND (SELECT count(*) FROM pg_constraint WHERE conrelid='public.ca_horse_hand_receipts'::regclass AND contype='c')=2
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A HAND RECORDS WHICH HORSE OPTION RECEIPTS FIRED IN IT (2026-11-25, Hold'em
-- Strategy lane, design agreed with the Hold'em owner).
--
-- Until now a Horse option left only a daily count in the database
-- (horse_brain_telemetry: day, feature, fires). Which HANDS an option changed
-- lived in the engine host's 72-hour decision journal, where no results query
-- can join it. So "did people do better or worse in the hands this option
-- changed" could not be answered from the database at all.
--
-- public.ca_horse_hand_receipts holds one row per (hand, receipt) for hands a
-- real person was dealt into. hand_id is hand_history.id. The engine writes
-- the rows after the hand's own commit, from the count it kept in memory while
-- the hand was played (server/src/services/HorseHandReceipts.ts,
-- server/src/engine/HorseHandOptionReceipts.ts). Read by
-- scripts/ops/person-vs-horse-results.mjs --by-option-receipt.
--
-- NO CARD OF ANY KIND. A row is the option's name, the KIND of action the
-- option was given and the KIND it left, and how many decisions of the hand
-- that happened in. `receipt` is exactly `<option>:<before>><after>` with
-- before in (none, fold, check, call, bet, raise, all_in) and after in the
-- same six actions; the CHECK below refuses anything else, so no card, board,
-- hand strength, equity or amount can be stored here even by mistake.
--
-- RETENTION FOLLOWS hand_history WITH NO PRUNER. hand_history keeps every hand
-- a person was dealt into (has_human) for good and prunes only Horse-only
-- hands (sp_prune_hand_history, has_human IS FALSE). The engine writes these
-- rows ONLY for hands with a person, so a row's hand is never pruned and the
-- row lives exactly as long as its hand. No cron, no reconciler.
--
-- NO HOT TABLE IS TOUCHED. A new empty table and nothing else: no foreign key
-- to hand_history (that would take SHARE ROW EXCLUSIVE on it; CLAUDE.md
-- section 2 rules 7, 9 and 10; ca_hand_facts carries none either), no trigger,
-- no function, no index beyond the primary key, no ALTER of any existing
-- relation. It needs no install window.
--
-- NO BROWSER ACCESS. RLS on with no policy; PUBLIC, anon and authenticated
-- hold nothing; service_role inserts and reads and cannot update or delete.
--
-- NO HORSE DECISION CHANGES. Nothing on the decision path reads this table.
--
-- One transaction, one schema-cache reload.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE TABLE public.ca_horse_hand_receipts (
  hand_id   uuid     NOT NULL,
  receipt   text     NOT NULL,
  decisions smallint NOT NULL,
  CONSTRAINT ca_horse_hand_receipts_pkey PRIMARY KEY (hand_id, receipt),
  CONSTRAINT ca_horse_hand_receipts_receipt_is_option_and_action_kinds CHECK (
    receipt ~ '^[A-Za-z][A-Za-z0-9]{0,63}:(none|fold|check|call|bet|raise|all_in)>(fold|check|call|bet|raise|all_in)$'
  ),
  CONSTRAINT ca_horse_hand_receipts_decisions_counted CHECK (decisions BETWEEN 1 AND 999)
);

COMMENT ON TABLE public.ca_horse_hand_receipts IS
  'One row per (hand, Horse option receipt) for hands a person was dealt into: the option name, the kind of action before and after the option acted, and how many decisions of the hand. Never a card, strength, equity or amount. hand_id is hand_history.id (no foreign key: hand_history is a hot table). Service role only. Written by server/src/services/HorseHandReceipts.ts; read by scripts/ops/person-vs-horse-results.mjs.';

ALTER TABLE public.ca_horse_hand_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_horse_hand_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ca_horse_hand_receipts TO service_role;

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ca_horse_hand_receipts'::regclass) THEN
    RAISE EXCEPTION 'ca_horse_hand_receipts must keep row level security on';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ca_horse_hand_receipts', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.ca_horse_hand_receipts', 'SELECT')
     OR has_table_privilege('service_role', 'public.ca_horse_hand_receipts', 'UPDATE')
     OR has_table_privilege('service_role', 'public.ca_horse_hand_receipts', 'DELETE')
     OR has_table_privilege('anon', 'public.ca_horse_hand_receipts', 'SELECT')
     OR has_table_privilege('anon', 'public.ca_horse_hand_receipts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ca_horse_hand_receipts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_hand_receipts', 'INSERT') THEN
    RAISE EXCEPTION 'ca_horse_hand_receipts grants are not service-role insert and read only';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.ca_horse_hand_receipts'::regclass AND contype = 'f') THEN
    RAISE EXCEPTION 'ca_horse_hand_receipts must carry no foreign key';
  END IF;
END
$verify$;

COMMIT;
