# Cert residue has one reader, and a finished owner of record leaves the inventory (2026-11-08)

## 1. One reader for stale certification residue

Since 2026-10-08 `scripts/ci/certify-club-create.mjs` ran
`cleanupStaleProductionE2EAccounts` in its always-run cleanup and pushed any
failure into its own verdict. Residue left by OTHER runs (the UI lane,
post-deploy, rabbit hunt) therefore painted the Club Create certificate red
although club creation had passed, while `cert-residue-sweep.yml` ran the same
code on operator dispatch.

Now:

- The Club Create certificate no longer embeds that recovery. Its verdict is
  club creation and its own fixtures only (its own cleanup failures are still
  a loud `AggregateError`).
- `cert-residue-sweep.yml` is the one reader. It keeps the operator start
  (full sweep: stale accounts, then stale certification clubs) and also starts
  on every completed Club Create Certification run with
  `sweep-stale-accounts`, which is exactly the account recovery the
  certificate used to embed. There is no timer (2026-10-31 operator policy
  holds). A red run of it on main is read by `check-main-is-green`
  (`production-integrity-audit.yml`), and its failure message names the sweep
  and the #9830 residue pattern.

Pinned by `tests/unit/clubCreateCertificationContract.test.ts` and
`tests/unit/productionE2EAccount.test.ts`.

## 2. A finished owner of record is retired once and stops being listed

`certify-rabbit-hunt.mjs` mints a fresh owner per run, and retained Crest Cert
templates leave the same shape: a reserved identity kept as the owner of
record of a retired club (the account door refuses any club owner, and a
retired club with history is never deleted). Its password and sessions were
never retired, so `fn_ca_stale_certification_accounts` listed it on every
sweep for ever. Production on 2026-11-08: eight such identities (49ee6036,
f55926cf, 748a15d9, 0f1f28e9, bc740156, b41ccb19, 205db075, 1eb1fe67), each
owning one retired club with zero treasury/promo/insurance/pool and no open
table, holding only its zero-balance owner membership; five had live sessions.

Migration `20261108035207`:

- `fn_ca_certification_owner_of_record_state(uuid)` (read-only, service-only)
  answers `not_finished`, `credentials_live` or `retired`, using the same
  custody fragments as the account door and
  `fn_ca_certification_identity_retired`. Read against production before
  merge: the eight read `credentials_live`; the two other stale identities
  (a live Crest Cert Template owner and a KINGS CLUB admin) read
  `not_finished`.
- `fn_ca_stale_certification_accounts` skips a `retired` owner of record; its
  envelope, owner, ACL and configuration are unchanged.

`production-e2e-account.mjs`: a kept owner of record is read; a
`credentials_live` one is soft-deleted through GoTrue (the same call the
door's `auth_soft_delete_required` answer uses) and must read `retired`
afterwards. `not_finished`, an unreadable answer, or a soft delete that does
not read back `retired` is a named failure of the sweep, never a quiet keep.

Native proof: `scripts/ci/fixtures/certification-retirement/qualify-owner-of-record.py`
(run by `scripts/ci/test-certification-retirement-postgres.py`): the
production preimage, the listed-for-ever reproduction, refused drift, rolled
back install, replay, ACL, every live custody form still listed, and the
Auth-retired owner leaving the inventory with the retired club untouched.
