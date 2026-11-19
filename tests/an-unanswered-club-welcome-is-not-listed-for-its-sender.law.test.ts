/**
 * AN UNANSWERED CLUB WELCOME IS NOT LISTED FOR ITS SENDER
 *
 * Read on production 2026-11-18: one club owner held 1,299 personal Messenger
 * threads and 1,272 of them contained nothing except club welcomes that owner
 * had sent. The welcome trigger opens a one-to-one thread for every admitted
 * member, so the sender's inbox filled with threads nobody had written in.
 *
 * THE RULE. fn_get_user_conversations does not list a one-to-one thread whose
 * every message is a club welcome the viewer sent. It is listed again as soon
 * as the other person writes anything, or the viewer writes a message of their
 * own. The recipient's inbox is unaffected, and groups are untouched.
 *
 * WHAT WAS REJECTED. The first proposal was to stop sending the welcome to
 * horses. CLAUDE.md 10.5 forbids it: a horse is sent what a human is sent, and
 * a sender who gets a thread for some members and not for others has been told
 * which members are horses. So the rule here decides by WHO WROTE the messages
 * and never by who the member is. The welcome trigger still skips only what
 * fn_ca_is_cert_account claims (tests/the-inbox-never-shows-a-nameless-thread).
 *
 * Behaviour is proved on a real database by
 * scripts/ci/test-messenger-unanswered-welcome.py; this file pins the source.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .sort();

/** The newest migration that states the whole function, and that function's text. */
function latest(name: string): { file: string; body: string } {
  const header = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i');
  for (const file of [...files].reverse()) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    const start = sql.search(header);
    if (start < 0) continue;
    const rest = sql.slice(start);
    const end = rest.search(/\$function\$\s*;/);
    return { file, body: rest.slice(0, end > 0 ? end : rest.length) };
  }
  throw new Error(`no migration defines public.${name}`);
}
const code = (body: string) => body.replace(/--[^\n]*/g, '');
const squash = (text: string) => text.replace(/\s+/g, ' ');

const PREDICATE =
  'AND (COALESCE(c.is_group, false) OR EXISTS ( SELECT 1 FROM public.social_messages spoken ' +
  'WHERE spoken.conversation_id = c.id AND (spoken.sender_id IS DISTINCT FROM p_user_id ' +
  "OR spoken.media_metadata->>'club_welcome' IS DISTINCT FROM 'true')))";

describe('an unanswered club welcome is not listed for its sender', () => {
  const inbox = latest('fn_get_user_conversations');
  const body = squash(code(inbox.body));

  it("lists a one-to-one thread only when somebody wrote more than the viewer's own welcome", () => {
    expect(body, `${inbox.file} lost the unanswered-welcome predicate`).toContain(PREDICATE);
  });

  it('decides by who wrote the message, null-safely, so an ordinary message always counts', () => {
    // `<>` or `!=` would drop a message with no metadata (NULL ->> is NULL)
    // and hide every ordinary thread the viewer started.
    expect(body).not.toMatch(/club_welcome'\s*(<>|!=|=)\s*'/);
    expect(body).not.toMatch(/spoken\.sender_id\s*(<>|!=)/);
  });

  it('never decides by what kind of member the other person is (CLAUDE.md 10.5)', () => {
    expect(inbox.body).not.toMatch(/is_horse/i);
    expect(inbox.body).not.toMatch(/fn_can_see_horse_flag|horse_id/i);
  });

  it('leaves groups alone and keeps every earlier inbox rule', () => {
    expect(body).toContain('AND (COALESCE(c.is_group, false) OR ou.id IS NOT NULL)');
    expect(body).toContain('counterpart_account.deleted_at IS NOT NULL');
    expect(body).toContain('OR NOT public.fn_ca_is_cert_account(ou.id)');
    expect(body).toContain('public.accounting_invoice_deliveries d');
    expect(body).toContain(
      'ORDER BY (inbox.unread_count > 0) DESC, inbox.last_message_at DESC NULLS LAST'
    );
  });

  it('is installed over a known preimage and proves nothing else changed', () => {
    const sql = readFileSync(join(DIR, inbox.file), 'utf8');
    expect(sql).toMatch(/<> '[0-9a-f]{32}' THEN\s+RAISE EXCEPTION '[^']*preimage changed/);
    expect(sql).toMatch(
      /md5\(replace\(pg_get_functiondef\(.*?::regprocedure\),\s*v_added,\s*''\)\)/
    );
    // A projection: the migration writes no row.
    expect(code(sql)).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE)\b/i);
  });

  it('the previous definition is kept as the rollback and listed the thread', () => {
    const previous = readFileSync(
      join(ROOT, 'tests', 'fixtures', 'messenger-unanswered-welcome', 'production-inbox.sql'),
      'utf8'
    );
    expect(squash(code(previous))).not.toContain('club_welcome');
    // The candidate is the previous definition plus the predicate, nothing else.
    const strip = (text: string) => squash(code(text)).replace(` ${PREDICATE}`, '').trimEnd();
    expect(strip(inbox.body)).toBe(
      squash(code(previous))
        .replace(/\$function\$\s*;\s*$/, '')
        .trimEnd()
    );
  });

  it('the welcome is still sent to every member: the trigger has no horse test', () => {
    // The same pin tests/the-inbox-never-shows-a-nameless-thread holds, restated
    // here because this law exists instead of a per-member skip.
    const trigger = code(latest('fn_deliver_club_messenger_welcome').body);
    expect(trigger).not.toMatch(/is_horse/i);
  });
});
