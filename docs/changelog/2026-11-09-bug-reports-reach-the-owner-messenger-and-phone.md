# Bug reports reach the owner's Messenger and phone (2026-11-09)

Owner instruction: "ALL BUGS SHOULD GO DIRECTLY TO MY SMARTER.POKER MESSENGER, AND SEND A PUSH ALERT TO MY PHONE."

## What was wrong, read from rows

- Report BUG-7C1347FF (`live_help_tickets` `7c1347ff-7e28-403c-aa4d-4335176252a7`, 2026-11-09 10:11:55 UTC, priority high) reached the owner as an email only.
- `fn_submit_bug_report_to_admin` stored the ticket and posted the report as a direct message from the reporter to the `support` account (`7f5b582a`). That account has never signed in and has no push subscription. The message is `social_messages` `374c296b` in conversation `9684bfaa`; nobody could read it.
- Nothing was written to the owner's Messenger and no `push_outbox` row was created.
- Club Arena's Help form writes `user_feedback` directly from the browser. No reader, email or notification has ever consumed that table.

## Traced delivery paths

- Messenger: `/hub/messenger` reads the `social_*` stack (`social_conversations`, `social_conversation_participants`, `social_messages`) through `/api/messenger/get-conversations` and `/api/messenger/get-messages`, with realtime on `social_messages`. The `messenger_*` message tables are empty and unused for messages.
- Push: `push_outbox` is drained every minute by the World Hub `/api/cron/push-dispatch` route (`claim_push_outbox_batch`, preference gate, digest, `push_subscriptions`, receipts in `push_dispatch_runs`). Guards that divert the wrong shape: `fn_platform_push_recipient_guard` (operational alert events and titles), the owner operational router in the dispatcher, and the notification mirror's pending cap. A row with its own `bug_report` event matches none of them.

## Recipient evidence

`47965354-0e56-43ef-931c-ddaab82af765` (`kingfish`, profile "Dan Bekavac", role admin) is the owner's Messenger account: last sign-in 2026-11-09, last Messenger read 2026-11-09 05:31 UTC, thousands of sessions, the id the platform's own owner predicates name, and the only candidate with active subscriptions (an iPhone on `web.push.apple.com` with a device receipt at 2026-11-09 14:46:08 UTC, and a Mac). The other candidates last used Messenger in October or earlier and hold no active subscription. The choice rests on Messenger use and identity, and the subscriptions agree with it.

## The fix

Migration `20261109224532_bug_reports_reach_the_owner_messenger_and_phone.sql`:

- `bug_report_routing`: one configured row (recipient, sender, conversation). The recipient is constrained by `fn_is_platform_alert_recipient`, so reports cannot be pointed at a non-owner account.
- `bug_report_deliveries`: one receipt per source row, unique on `(source_table, source_id)`, holding the message id, outbox id, status and last error.
- `fn_route_bug_report_to_owner(source_table, source_id)`: one Messenger message from the platform service identity (`smarterpoker`) into one dedicated conversation with the owner, one `push_outbox` row with event `bug_report`, one receipt. Idempotent per source row.
- Trigger `zz_bug_report_reaches_owner` AFTER INSERT on `live_help_tickets` and `user_feedback`. The route runs in the inserting transaction, so no client can skip it and no timer or sweep exists. A routing fault never loses the report: the row commits, the receipt records `failed` with the error and Production Alerts receives one event.
- BUG-7C1347FF is delivered once by the same route inside the migration. The five older tickets (three May auto-tests and two May reports from the owner's own accounts) are deliberately left.

## Entry points

| Entry point                                                              | Stores              | Covered by     |
| ------------------------------------------------------------------------ | ------------------- | -------------- |
| World Hub and Club Commander report widget (`/api/live-help/report-bug`) | `live_help_tickets` | insert trigger |
| Live-help escalation (`/api/live-help/create-ticket`)                    | `live_help_tickets` | insert trigger |
| Club Arena Help form                                                     | `user_feedback`     | insert trigger |

Not bug-report entry points and unchanged: `horse_bug_reports` (machine diagnostics from the horse fleet), `user_reports`, `messenger_reports`, `social_page_reports`, `commander_home_content_reports` (conduct and content moderation), `training_question_reports` and `trivia_question_reports` (question quality).

No entry point uploads an attachment today (`user_feedback.screenshot_url` is always null and the widget has no file field), so the message carries text only.

## Proof

- `scripts/ci/test-bug-report-routing.sh` (native PostgreSQL, wired into `scripts/ci/test-data-console-postgres-contracts.sh`): reproduces the defect, applies the migration twice, and asserts one message, one push and one receipt per report, the backfill once, callers under row level security, anonymous reports, fault handling and that operational alerts are still diverted.
- `tests/bug-reports-reach-the-owner-messenger-and-phone.law.test.ts` pins the source contract.

## Limits

- The push follows the owner's own notification settings in the existing dispatcher (currently push on, no quiet hours, no daily cap). Three or more reports queued in the same minute are combined into one push by the dispatcher's existing digest; each still has its own Messenger message.
- The message links to the operator console ticket queue; there is no per-ticket page to link to.
