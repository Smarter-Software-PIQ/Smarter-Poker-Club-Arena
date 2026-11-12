# Lightning readiness recognises the exact Horse arrival pacing (alert 371597)

**What broke.** Post-Deploy E2E has not completed a production verification since 2026-11-09, which is episode row 371597 in `operational_alert_events` (99 deliveries). One of the failures it reports every run since 2026-11-11 is "Certify the authenticated Lightning operator cold loads", with `readiness invariant law_10_5` expected true, received false (run 43210315096, job 131156857551, on `7608c4721`).

**Root cause, read from production.**

- `fn_lightning_rollout_readiness` sets `law_10_5` false when any public `fn_lightning_*` function's comment-stripped definition matches `is_horse|horse_id`.
- Since 20261106155602 it recognises one horse-plumbing function by its exact identity: `fn_lightning_auto_rebuy`, the horse's rebuy input.
- 20261111214248 (#10530) installed `fn_lightning_horse_admit_paced`, and 20261112005012 redefined it. That function paces Horse seat inserts: the owner's 70 to 90 second arrivals, with a lone person's heads-up opponent seated at once. It reads `p.is_horse`, and nothing taught readiness its identity.
- A live read of every `fn_lightning_*` function finds exactly these two horse readers.

**Fix.** Migration `20261112135242` adds one recognised identity to the `law_10_5` scan, built the same way as the rebuy input:

- the exact signature;
- the installed definition md5 `ba5d6df55992dde8d2dce9a9295816cd`;
- owner postgres, and no EXECUTE for service_role, authenticated, anon or PUBLIC.

Any later change to that function, its owner or its grants falls back under the blanket scan.

**Read-only proof against production** (no DDL):

- the anchor occurs once in the predecessor (`d2e611fa…`);
- the replacement reverses byte for byte;
- the patched predicate evaluates true, and the installed one false.

The migration asserts all of this again inside its own transaction and aborts on any drift.

**Hardening.**

1. **Regression law:** `tests/lightning/a-horse-reading-lightning-function-is-recognised-by-readiness.law.test.ts`. Every `fn_lightning_*` function whose latest migration definition reads horse identity must have a readiness recognition at the same or a later version. Without the new migration it fails and names `fn_lightning_horse_admit_paced`; with it, it passes.
2. **Invariant:** the recognition is exact-identity, so a redefinition is refused again until reviewed.
3. **Detection:** the existing Post-Deploy E2E Lightning operator certificate. It writes `PostDeployVerificationIncomplete` to `operational_alert_events` with `payload.target_task_id`.
4. **CI gate:** `Client Unit Tests (vitest)`, which runs `tests/**/*.test.ts` on every PR.

**Not changed.**

- No readiness verdict, rollout flag, seat, wallet, gameplay or configuration row is written.
- The other failures in the same Post-Deploy runs are separate causes and are tracked separately on the Production Alerts board: club-members activity caption, customization realtime, premium storefront SKUs, the naturally-full-table witness, and the catalog observers timeout.

## Probe readback (production, read-only, 2026-11-12)

| field                                     | value                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| occurrences of anchor                     | 1                                                                               |
| before_md5                                | d2e611fa3e858c45213a40c80829626c                                                |
| after_md5 (text replace)                  | 29c7ce1f7a5e7c36e0d98dea3a221ec5                                                |
| reversible                                | true                                                                            |
| law_10_5 with patch                       | true                                                                            |
| law_10_5 as installed                     | false                                                                           |
| horse-reading fn*lightning*\* (live)      | fn_lightning_auto_rebuy, fn_lightning_horse_admit_paced                         |
| fn_lightning_horse_admit_paced            | md5 ba5d6df55992dde8d2dce9a9295816cd, owner postgres, acl {postgres=X/postgres} |
| callers of fn_lightning_horse_admit_paced | fn_lightning_admission_policy(), fn_ca_horse_roster_seat_guard()                |
