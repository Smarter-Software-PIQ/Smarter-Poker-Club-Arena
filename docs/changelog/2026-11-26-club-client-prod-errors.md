# 2026-11-26 A request that cannot succeed is not sent

Production Postgres logged these from the Club Arena browser in the 24 hours to 21:45 UTC. Each one came from a client path that sent a call the database could only refuse.

| Signature | Count | Root cause | Fix |
| --- | --- | --- | --- |
| `not authorized for this club` (ca_club_operations_overview) | 454 | The overview was read for every staff role, but the RPC admits owner, co_owner, admin and platform staff only. A refusal was not remembered, so polls asked again. | Callers read only under `mayReadClubOperationsOverview(access)` (canControlClub, settled). A refused scope is latched until a role or membership event clears it. The page shows "Live Readings Restricted For This Role" without a round trip. |
| `ACCOUNT_CLOSED` (fn_update_presence) | 164 | The presence heartbeat kept beating after a terminal refusal. | ACCOUNT_CLOSED and SESSION_REVOKED / PT401 silence presence for that user and stop the interval; a revoked session also asks to sign in again. |
| `invalid input syntax for type uuid: "crest-cert-..."`, `"kings-club"` | 62 | ClubSettingsPage passed the route slug to SpinActivationPanel; the World Hub route reads `clubs.id`. | The panel gets `clubUUID`. The Spin service and useSpinsWallet refuse a non-uuid owner before any request. |
| `invalid input syntax for type uuid: "demo"` | many | MultiTablePage and GameAccessService sent unresolved slugs to uuid reads. | Both send only uuids; GameAccess answers `unknown_club`. |
| `new row violates row-level security policy for table "horse_bug_reports"` | 7 | Repeated bugs were upserted. ON CONFLICT also needs the admin-only SELECT policy, so every repeat was refused, and no fingerprinted row has landed since 2026-11-18. | Repeats are not written to horse_bug_reports; they reach the first-party client error sink. First occurrences still insert. |
| `function fn_cashier_mint_scope / fn_ca_shared_hand_count_view does not exist` | 76 | check-migrations-are-live ran `@live-proof` expressions for a merged migration whose objects were not installed yet (07:28 to 10:17 UTC). | Proofs of a migration whose objects are missing are skipped; the missing objects are still reported. |

Not defects, left as they are: the challenge RPC denials and the export / not_authorised denials are production E2E negative-access probes, and the SESSION_REVOKED bursts are the single-device revocation on page load.

Hardening: `tests/a-refusal-that-cannot-succeed-is-not-sent.law.test.ts` with `docs/laws.d/a-refusal-that-cannot-succeed-is-not-sent.md`, plus unit tests for each path.
