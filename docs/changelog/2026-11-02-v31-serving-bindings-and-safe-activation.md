# V31 Serving Bindings And A Safe Activation (2026-11-02)

## Problem

After #9366 a promoted V31 dataset was served by whatever engine ran: live workers loaded the active dataset at boot and every six hours with no compatibility check, so a later release or rollback served it on an unevaluated brain. The activation held the engine mutation lock for up to 480 s, which a release's ExecStopPost recovery waits only 5 s for. A host `timeout` killed only the `docker exec` client, and a partial eight-worker load could leave workers on different stores.

## Change

- Migration `20261102180625_v31_serving_bindings_admit_only_verified_engines`: `gto_v31_serving_bindings` (the engine commits proven closure-identical to the promoted epoch, with digest and provenance), `fn_gto_v31_bind_serving`, `fn_gto_v31_revoke_serving`, `fn_gto_v31_serving_admission`.
- Live decision workers arm a serving gate (`requireGtoV31ServingBinding(GIT_COMMIT_SHA)`): without an open binding for their own commit they serve the empty store and report it. A changed active dataset is dropped before loading, so two datasets are never served side by side. The binding is re-read after the pages are collected.
- The activation no longer takes `/var/lock/club-arena-engine-up.lock` (its own activation lock only). Steps: promote, bind, load, status, readiness. Any failure after binding revokes the binding and proves all eight workers empty with `reloadPublic215Stores clear`. Every in-container step records its PID and is killed and proven gone on timeout; the in-container scripts also exit on their own deadline.
- Promotion refuses a serving engine without the gate.

## Proof

- `scripts/ci/test-v31-serving-bindings.py --mutations` (PostgreSQL 17).
- `node --test scripts/ci/gto-v31-qualification.test.mjs scripts/ci/v31-atomic-promotion.test.mjs`.
- `server/src/services/GtoPostflopV31ServingGate.test.ts`, `server/src/scripts/reloadPublic215Stores.test.ts`.
