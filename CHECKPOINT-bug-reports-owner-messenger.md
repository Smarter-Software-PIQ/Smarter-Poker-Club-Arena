# Checkpoint: bug reports reach the owner's Messenger and phone

Owner instruction, 2026-11-09: "ALL BUGS SHOULD GO DIRECTLY TO MY SMARTER.POKER MESSENGER, AND SEND A PUSH ALERT TO MY PHONE." Recipient account confirmed by the owner the same day. Account, reporter and device details are deliberately not recorded in this public file; they are in the database rows named below.

## Scope and acceptance

- Every supported report entry point saves its record, then produces exactly one owner Messenger message and one phone push, keyed by the record id.
- Entry points: World Hub and Club Commander report widget and live-help escalation (`live_help_tickets`), Club Arena Help form (`user_feedback`).
- Excluded, not bug-report entry points: `horse_bug_reports` (fleet diagnostics), conduct and content report tables, question-quality report tables.
- No entry point uploads an attachment today, so no private file is exposed by this route.
- The report widget inbox in World Hub is a separate delivery owned by another lane (World Hub PR #2754).

## States, kept separate

| State         | Evidence                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented   | Migration `20261109224532_bug_reports_reach_the_owner_messenger_and_phone.sql`; `docs/changelog/2026-11-09-bug-reports-reach-the-owner-messenger-and-phone.md`                                                                                           |
| Tested        | `scripts/ci/test-bug-report-routing.sh` passed on PostgreSQL 16 locally and PostgreSQL 17 in CI (accounting shard 2); `tests/bug-reports-reach-the-owner-messenger-and-phone.law.test.ts` 8 of 8                                                         |
| Merged        | PR #10243, head `566f5ff7ea9e305badf4ebbf1757f0bfdb16e3a5`, 77 checks success, 5 skipped, 0 failed; squash commit `923a821c9cef0429e82dde2f5c57d2fb962e8aaf`                                                                                             |
| Installed     | Dispatch Merged Migrations run 42726873557 success; Apply Merged Migration run 42726942990 success; `schema_migrations` holds version `20261109224532`; trigger `zz_bug_report_reaches_owner` enabled on both tables; `bug_report_routing` holds one row |
| Published     | Database only. No client, engine or World Hub component changed in this lane                                                                                                                                                                             |
| Verified live | See below, read back 2026-11-10 00:19 to 00:21 UTC                                                                                                                                                                                                       |

## Live evidence

| Report                                                                            | Ticket id                              | Receipt (`bug_report_deliveries`)          | Messenger message                            | Push outbox row                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| BUG-7C1347FF (the original, delivered by the migration)                           | `7c1347ff-7e28-403c-aa4d-4335176252a7` | 1 row, delivered, attempts 1, 00:16:31 UTC | 1 row `2b75f1a4-4942-4ff5-b0b9-4f0e04bb88af` | 1 row `654302a5-3730-45c0-9ed8-177497be9aff`, event `bug_report`, sent 00:17:01 UTC, attempts 1 |
| BUG-4355ADBA (labelled test, anonymous, through `POST /api/live-help/report-bug`) | `4355adba-d34e-4d1c-a479-4c270d88932c` | 1 row, delivered, attempts 1, 00:17:33 UTC | 1 row `7a17a430-0954-4057-8cd0-57dbe18bd874` | 1 row `57b852a0-5c64-4c53-a1a2-ee91f8469bb4`, event `bug_report`, sent 00:18:01 UTC, attempts 1 |

The dedicated conversation holds exactly two messages, one per ticket. No `bug-report-routing` operational alert exists.

Push, by level observed:

- Queued: yes, in the ticket's own transaction.
- Claimed and provider accepted: yes. Dispatcher slots 00:17 and 00:18 UTC each sent 1 and failed 0; both of the recipient's active subscriptions (one Apple web push, one FCM web push) were used with no failure.
- Device receipt: yes for the test push on both subscriptions, within about one second of the send. The receipt column keeps only the latest value, so the original report's own receipt cannot be separated afterwards.
- Banner visibly displayed on the handset: not observed. Pending the owner's confirmation.

Messenger: the recipient's own session recorded read receipts for both messages within seconds of arrival. This lane did not sign in to the owner's account.

## Decisions

- The five older tickets (three May auto-tests, two May reports from the owner's own accounts) were deliberately not delivered.
- A routing fault keeps the report, records `failed` on its receipt and raises one Production Alerts event; it never blocks the report.
- The push follows the recipient's own notification settings in the existing dispatcher. Three or more reports queued in the same minute are combined into one push by the dispatcher's existing digest; each keeps its own Messenger message.
- `tests/a-horse-is-never-the-reason-a-player-is-not-paid.law.test.ts`: the migration scan's per-test budget went from the 30 s default to 120 s, with the measurements beside it. No assertion, pattern, cutoff or exemption changed. Cause: the scan's file took 17.4 to 31.2 s across fourteen CI shard runs and timed out on this PR's first head with no assertion reached; with and without this lane's migration it measured 8.6 s against 8.5 to 9.1 s locally.

## Remaining

- Owner confirmation that the test push banner showed on his phone.
- World Hub widget inbox: PR #2754, another lane.
