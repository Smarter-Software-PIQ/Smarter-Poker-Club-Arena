# 2026-11-07 - the Cert Residue Sweep settles the rabbit-hunt residue the history door cannot (#9830)

## What was wrong

`Club Create Certification` failed 45+ consecutive runs from
2026-11-07T10:39Z. The certificate passed; its always-run cleanup embeds
`cleanupStaleProductionE2EAccounts`, which failed on 11 of 11 stale
identities. Read from production on 2026-11-07:

| group | identities | what they own | refusal |
| --- | --- | --- | --- |
| A. orphaned ACTIVE welcome templates (runs died 11-01/02) | 49ee6036, f55926cf, 748a15d9 | clubs 96bd011b, b3ec63d3, a15f7d9e: 58-59 CANCELLED receipted boards + 12 REGISTERING, 15 cash tables | `WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED` |
| B. RETIRED welcome templates | b41ccb19, 205db075 | clubs 0be5ee41, 79210a6a | `WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED` |
| C. rabbit-hunt owners | 0f1f28e9, bc740156 | retired `Cert RH` clubs 110fc34f, 1ad7b7b9 (22 tables, 21-23 hands) | `Refusing to retire unrecognized club` |
| D. rabbit-hunt players | 1059cbec, ac293d50, 39beae07, 0412d136 | one vacated seat at a closed table (stack = the engine's posted `table_cashout`), one zero-balance `player` row in the retired `Cert RH` club (agent = owner), one ledger row as actor | `CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY` |

Groups A and B are #9959's (`20261107211612_a_stale_welcome_fixture_retires_with_its_empty_past_boards`,
merged and installed today): the welcome unwind no longer counts a cancelled,
never-started generation whose receipt moved nothing as a second board, and
`fn_ca_retire_stale_welcome_fixture_with_history` retires such a fixture
through the owner's `fn_retire_settled_club` with its records kept. The stale
sweep calls that door for `WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED` on
any fixture that is not the run's own template. This change does not touch
that path.

Groups C and D are this change's. Two root causes:

1. **`Cert RH` was unknown to the sweep.** `certify-rabbit-hunt.mjs` names
   its club `Cert RH <digits>`; `CERTIFICATION_CLUB_NAME_PREFIXES` knew only
   the Crest names, so every run threw `Refusing to retire unrecognized club`
   for the two owners, for ever. No welcome door could ever retire that club
   anyway: it has seats, hands and 15 cancelled tournaments by design, and its
   own run already retired it through `fn_retire_settled_club`. A retired
   `Cert RH` club is exactly the "owner of record of retired history"
   disposition the sweep already records for a Crest fixture.
2. **The account door counted history as custody.**
   `cleanup_reserved_certification_account` (both guarded branches) and
   `fn_ca_certification_identity_retired` refused ANY `table_seats` row and
   ANY membership outside the two prepared staff scopes. Those rules predate
   any certificate that sat down; the rabbit-hunt certificate seats two
   players and cashes them out, so its players could never be retired.

## Shipped

- `supabase/migrations/20261107210316_certification_cleanup_counts_only_live_seats_and_leaves_a_re.sql`
  (installed from protected main by Apply Merged Migration only): a seat is
  custody only while live (`left_at IS NULL`, or its table is not terminal or
  missing, or a vacated non-zero stack has no matching posted `table_cashout`
  ledger row for that player, table and amount within a minute of `left_at`);
  a zero-balance `player` row (chip/promo/held/locked 0, no agent other than
  the club owner, no parent agent) in a club whose `lifecycle_status` is
  `retired` is admitted by the ledger-actor branch and removed in its existing
  DELETE, under `app.club_retirement_maintenance` for that one statement
  (restored before anything else runs). Every other guard is asserted
  byte-present after the patch; owner, ACL (service_role only) and
  configuration are re-read. Preimages re-read from production after #9959:
  door `32fccc83b62d77ae9f23c530af591c1c` (20261102201808 postimage),
  predicate `fbaa2d123a08aca20a597b6273be73e4` (20260927032118).
- `scripts/ci/production-e2e-account.mjs`: `Cert RH ` joins the recognized
  prefixes. Stale sweep only: a retired `Cert RH` club is the owner's retained
  history without any door; an active one is refused loudly (its members hold
  chips; only its own run settles it). `databaseClientFactory` reaches the
  sweep. The sweep's failure names the operator-run Cert Residue Sweep and the
  #9830 pattern (`STALE_RESIDUE_SWEEP_HINT`); the certification stays the one
  reader and `cert-residue-sweep.yml` stays dispatch-only.
- `scripts/ci/certify-rabbit-hunt.mjs`: `verdict` fails on any cleanup step
  that is not `ok: true`; the owner kept as owner of record of its RETIRED club
  (`ownerRetainedAsRecord`: exactly the custody refusal, club reads retired and
  owned) is the one terminal outcome recorded as done. No sanctioned persistent
  reserved identity exists (`E2E_TEMPLATE_CLUB_ID` reuses a club and a
  membership, never an identity), so minting is unchanged; the players are now
  removable by the fixed door.

## Proofs

- `tests/unit/productionE2EAccount.test.ts`: retired `Cert RH` kept without a
  door and named; active refused with the hint; never retained for a live run.
- `tests/unit/certifyRabbitHunt.test.ts`, `tests/unit/clubCreateCertificationContract.test.ts`.
- Native PostgreSQL `scripts/ci/fixtures/certification-retirement/qualify-residue.py`
  (wired into `test-certification-retirement-postgres.py`): brings the door to
  the production preimage, reproduces the Group D refusal, installs the
  migration (rollback, apply, replay, ACL), proves every live form of the seat
  (occupied, table not closed, table missing, cash-out amount/status/time/table
  mismatch) and every other membership shape (role, each balance, agent,
  parent agent, active club, second club, tournament, agent row, ownership)
  is still refused, then the exact residue shape is admitted, only the
  retired-club player row is removed, the retired-club guard saw the
  maintenance setting on and restored, the ledger, seat and clubs are
  byte-identical, and the identity reaches `retained_ledger_actor` and leaves
  the stale inventory.

## What each group goes through after merge (dispatch `cert-residue-sweep.yml`)

- **A, B**: #9959's history door (unchanged here): A retires with 58-59
  generations kept; B answers `already_retired`; both identities kept as
  owners of record.
- **C**: club recognized by name, already retired, kept as owner of record
  without any door.
- **D**: the account door admits the vacated cashed-out seat and the
  retired-club player row, deletes that row, answers
  `auth_soft_delete_required`; the sweep soft-deletes Auth and the door
  answers `retained_ledger_actor`; `fn_ca_stale_certification_accounts` stops
  listing them.

The kept owners of A, B and C remain in the inventory on every run as
"kept as owners of record of retired history" and are never a failure.

## Deliberately not changed

- No watcher, cron, repair loop or reconciler. The sweep stays
  operator-dispatched; the certification stays its only reader.
- The welcome unwind, the history door and the terminal route are #9959's and
  #9836's; nothing here duplicates them. (`fn_get_club_welcome_package_reset_impact`
  still counts a cancelled generation as a second board, so the Retire Club
  dialog's `can_reset` can read false for a club the door now retires; that is
  the unwind lane's to align.)
- Retired records: owner memberships, tables, seats, receipts, hands and
  ledger rows of a retired club are never deleted; only a reserved identity's
  zero-balance `player` row is removed, by the guarded door.
- An ACTIVE `Cert RH` club is never touched by the sweep.
