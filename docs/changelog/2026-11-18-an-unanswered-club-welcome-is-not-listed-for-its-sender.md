# An unanswered club welcome is not listed for its sender (2026-11-18)

## What was wrong

The club welcome trigger (`deliver_club_messenger_welcome` on `club_members`) sends a Messenger message to every admitted member, from the member's agent or, failing that, the club owner. A second owner welcome follows ten minutes later. Each one opens a one-to-one thread in the sender's personal inbox.

Read on production on 2026-11-18 for one club owner:

- 1,299 personal one-to-one threads.
- 1,272 of them held nothing except welcomes that owner had sent.
- 583 of those were to horses (1,582 messages, no replies). 521 were created on 2 November, when 606 horses were re-admitted to clubs.
- 162 were to humans who never replied.
- 527 were to accounts that no longer exist. The reader already left those out.

So 745 welcome-only threads still had a counterpart. 658 of them were listed in the inbox that day; the rest were already left out because the counterpart's sign-in is retired. The owner's personal list was 684 threads, of which 26 held anything other than his own welcomes.

## The rule

`fn_get_user_conversations` does not list a one-to-one thread whose every message is a club welcome sent by the viewer (`sender_id` is the viewer and `media_metadata->>'club_welcome'` is `true`). The thread is listed again as soon as the other person writes anything, or the viewer writes a message of their own.

- The recipient's inbox is unchanged. Those messages are not theirs, so the thread is listed for them with its unread count.
- Groups are untouched.
- Accounting threads are untouched. An invoice message is not a club welcome, so the earlier accounting rule alone decides those.
- A hidden thread never has an unread message for the viewer, so unread totals do not change.

## Why horses are not skipped instead

The first proposal was to stop sending the welcome to horses. It was rejected. CLAUDE.md 10.5 is binding: a horse is sent what a human is sent, and `is_horse` is never used to leave a horse out. `tests/the-inbox-never-shows-a-nameless-thread.law.test.ts` already pins that the welcome trigger never reads `is_horse`. A per-member skip would also tell the sender which members are horses, because a thread would exist for some members and not for others.

This rule reads who wrote the messages in a thread and nothing about who the member is. Every member is still sent the same welcome, and the 162 human threads are treated exactly like the 583 horse threads.

## What changed

- `supabase/migrations/20261119015312_an_unanswered_club_welcome_is_not_listed_in_its_senders_inbox.sql` replaces `fn_get_user_conversations` with the installed definition plus one predicate in the WHERE clause. A preflight refuses unless the installed definition is the one read on production (md5 `30f13b0dd7777dd94fb9f363aa8c846f`). A postflight proves that the new definition with the predicate removed is that same definition, byte for byte. Signature, return columns, ordering, SECURITY DEFINER, search_path, the caller check and the grants are unchanged.
- No row is written, changed or deleted. The threads and messages remain, and removing the predicate lists them again.
- Cost: one more probe of `idx_messages_conversation` per candidate thread, ending at the first message that is not the viewer's own welcome. Production's plan for the predicate is an index scan on that index.

## Dependency

World Hub authorizes opening, reading and sending in a conversation through this reader. Its branch `agent/claude-horsewelcome/fix/an-unanswered-welcome-thread-still-opens` lets a sender open a thread that holds only their own welcomes. That change must be live before this migration is merged, or a sender could not write the first real message to a welcomed member.

## Tests

- `scripts/ci/test-messenger-unanswered-welcome.py` (CI shard 1): on a throwaway PostgreSQL 17 it loads the production definition, checks its md5, shows that it lists the welcome-only thread, applies the migration, and proves the thread is gone for the sender and present for the recipient, that it returns on a reply and on a message of the sender's own, that every other thread keeps its row, order and unread count, that stored rows and the routine's owner, grants and settings are unchanged, that a second run refuses, and that the rollback fixture restores the previous definition exactly.
- `tests/an-unanswered-club-welcome-is-not-listed-for-its-sender.law.test.ts` pins the predicate, its null-safe comparisons, the absence of `is_horse`, and that the only difference from the previous definition is the predicate.

## Rollback

Install `tests/fixtures/messenger-unanswered-welcome/production-inbox.sql` in a newly reserved one-transaction migration.
