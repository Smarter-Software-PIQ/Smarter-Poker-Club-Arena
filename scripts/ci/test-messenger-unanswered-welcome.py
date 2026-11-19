"""Native PostgreSQL proof: an unanswered club welcome is not listed in its sender's inbox.

Loads production's exact fn_get_user_conversations (its pg_get_functiondef md5
must equal the value read on production 2026-11-18) over stand-in relations,
then the migration. On the preimage a thread holding only the viewer's own
welcomes is listed. After the migration it is not, the recipient still sees it,
it returns on any reply or on any message the sender writes, every other thread
keeps its place and unread count, no stored row changes, the function keeps its
owner, ACL and settings, and a second run refuses. An empty throwaway cluster on
a Unix socket; no network, no production connection.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/fixtures/messenger-unanswered-welcome'
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119015312_*.sql'))
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
OWNER = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
ENV = dict(os.environ, LC_ALL='C')
PORT = '56431'
LIVE_MD5 = '30f13b0dd7777dd94fb9f363aa8c846f'
SENDER = '10000000-0000-4000-8000-000000000001'
SILENT = '10000000-0000-4000-8000-000000000002'
THREAD = '20000000-0000-4000-8000-00000000000%d'
WELCOME_ONLY = THREAD % 1


def command(args, sql=None, check=True):
    result = subprocess.run([str(arg) for arg in args], input=sql, text=True,
                            capture_output=True, env=ENV, timeout=60)
    if check and result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result


with tempfile.TemporaryDirectory(prefix='msg-welcome-') as directory:
    scratch = Path(directory)
    if OWNER:
        shutil.chown(scratch, 'postgres')
    cluster = scratch / 'db'
    command(OWNER + [PG / 'initdb', '-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-locale'])
    command(OWNER + [PG / 'pg_ctl', '-D', cluster, '-l', scratch / 'pg.log', '-w',
                    '-o', f"-p {PORT} -k {scratch} -c listen_addresses=''", 'start'])
    psql = [PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch,
            '-p', PORT, '-U', 'postgres', '-d', 'postgres']

    def inbox(user):
        """The reader's rows for one viewer, in the order it returns them."""
        out = command(psql, f"SET test.actor='{user}'; SELECT coalesce(json_agg(json_build_array("
                            f"conversation_id,unread_count,other_user_username,is_group,last_message_at)),'[]')::text "
                            f"FROM fn_get_user_conversations('{user}',null);").stdout
        return json.loads(out)

    def ids(rows):
        return [row[0] for row in rows]

    try:
        for filename in ['schema.sql', 'production-inbox.sql', 'grants.sql', 'fixtures.sql']:
            command(psql, (FIXTURE / filename).read_text())
        definition = "pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure)"
        assert command(psql, f'SELECT md5({definition});').stdout.strip() == LIVE_MD5, \
            'the preimage fixture is not the definition read on production'

        # THE DEFECT, on production's definition: the sender's inbox lists a
        # thread nobody has written in except the sender's own welcome.
        before = inbox(SENDER)
        assert WELCOME_ONLY in ids(before), 'the preimage no longer lists an unanswered welcome'
        assert ids(before) == [THREAD % n for n in (4, 2, 9, 8, 6, 5, 3, 1)], ids(before)
        recipient_before = inbox(SILENT)
        assert [row[:2] for row in recipient_before] == [[WELCOME_ONLY, 2]], recipient_before

        state = ("SELECT json_build_array((SELECT json_agg(p ORDER BY id) FROM profiles p),"
                 "(SELECT json_agg(m ORDER BY id) FROM social_messages m),"
                 "(SELECT json_agg(c ORDER BY id) FROM social_conversations c),"
                 "(SELECT json_agg(p ORDER BY conversation_id,user_id) FROM social_conversation_participants p),"
                 "(SELECT count(*) FROM messenger_hidden_messages))::text;")
        routine = ("SELECT json_build_array(proowner,proacl::text,prosecdef,provolatile,proconfig,prorettype,"
                   "pg_get_function_arguments(oid),pg_get_function_result(oid))::text FROM pg_proc "
                   "WHERE oid='public.fn_get_user_conversations(uuid,uuid)'::regprocedure;")
        stored, attributes, preimage = (command(psql, state).stdout, command(psql, routine).stdout,
                                        command(psql, f'SELECT {definition};').stdout)

        command(psql, MIGRATION.read_text())

        # Hidden for the sender, and nothing else moves: every other thread
        # keeps its row, its unread count, its name and its position.
        after = inbox(SENDER)
        assert WELCOME_ONLY not in ids(after), 'an unanswered welcome is still listed for its sender'
        assert after == [row for row in before if row[0] != WELCOME_ONLY], (before, after)
        unread = {row[0]: row[1] for row in after}
        assert unread == {THREAD % 4: 1, THREAD % 2: 1, THREAD % 9: 0, THREAD % 8: 0,
                          THREAD % 6: 0, THREAD % 5: 0, THREAD % 3: 0}, unread
        # The recipient's inbox is untouched: the welcome is theirs to read.
        assert inbox(SILENT) == recipient_before
        # A projection only: no stored row and no property of the routine changed.
        assert command(psql, state).stdout == stored, 'the migration changed stored rows'
        assert command(psql, routine).stdout == attributes, 'owner, ACL, security or signature changed'
        installed = command(psql, f'SELECT {definition};').stdout
        added = [line for line in installed.splitlines() if line not in preimage.splitlines()]
        assert len(added) == 8 and len(installed.splitlines()) == len(preimage.splitlines()) + 8, added
        assert 'is_horse' not in installed.lower()

        # A stale source cannot be silently overwritten or replayed.
        replay = command(psql, MIGRATION.read_text(), check=False)
        assert replay.returncode != 0 and 'preimage changed' in replay.stderr
        assert inbox(SENDER) == after

        # Any reply brings the thread back, with its unread count.
        command(psql, f"INSERT INTO social_messages(id,conversation_id,sender_id,is_deleted,created_at) VALUES"
                      f"('30000000-0000-4000-8000-000000000013','{WELCOME_ONLY}','{SILENT}',false,'2026-11-01 01:00');")
        replied = inbox(SENDER)
        assert [row[:2] for row in replied if row[0] == WELCOME_ONLY] == [[WELCOME_ONLY, 1]], replied
        command(psql, "DELETE FROM social_messages WHERE id='30000000-0000-4000-8000-000000000013';")
        assert inbox(SENDER) == after
        # So does anything the sender writes that is not a welcome.
        command(psql, f"INSERT INTO social_messages(id,conversation_id,sender_id,is_deleted,created_at,media_metadata) VALUES"
                      f"('30000000-0000-4000-8000-000000000014','{WELCOME_ONLY}','{SENDER}',false,'2026-11-01 02:00','{{\"sticker\":true}}');")
        wrote = inbox(SENDER)
        assert [row[:2] for row in wrote if row[0] == WELCOME_ONLY] == [[WELCOME_ONLY, 0]], wrote
        command(psql, "DELETE FROM social_messages WHERE id='30000000-0000-4000-8000-000000000014';")
        # A third welcome to the same member changes nothing.
        command(psql, f"INSERT INTO social_messages(conversation_id,sender_id,is_deleted,media_metadata) VALUES"
                      f"('{WELCOME_ONLY}','{SENDER}',false,'{{\"club_welcome\":true}}');")
        assert inbox(SENDER) == after
        assert [row[:2] for row in inbox(SILENT)] == [[WELCOME_ONLY, 3]]

        # The rollback fixture restores the preimage exactly.
        command(psql, (FIXTURE / 'production-inbox.sql').read_text())
        assert command(psql, f'SELECT md5({definition});').stdout.strip() == LIVE_MD5
        assert command(psql, routine).stdout == attributes
        print('PASS: production\'s preimage lists an unanswered welcome for its sender; the candidate does not, '
              'keeps it for the recipient, returns it on a reply or a message of the sender\'s own, leaves every '
              'other thread, count, stored row and routine property unchanged, refuses replay and rolls back exactly.')
    finally:
        command(OWNER + [PG / 'pg_ctl', '-D', cluster, '-m', 'immediate', 'stop'])
