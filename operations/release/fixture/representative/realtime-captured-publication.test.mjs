import assert from 'node:assert/strict';
import test from 'node:test';
import * as module from '../realtime-captured-publication.mjs';
const { realtimeCapturedPublicationInstallSql: install, realtimeCapturedPublicationObservationSql: observe } = module;
test('only the captured ordinary publication and single unfiltered parent membership are installed', () => {
  assert.deepEqual(Object.keys(module).sort(), ['realtimeCapturedPublicationInstallSql', 'realtimeCapturedPublicationObservationSql']);
  assert.match(install, /CREATE PUBLICATION supabase_realtime_messages_publication\s+WITH \(publish='insert, update, delete, truncate', publish_via_partition_root=false\)/);
  assert.match(install, /ALTER PUBLICATION supabase_realtime_messages_publication ADD TABLE ONLY realtime\.messages/);
  assert.doesNotMatch(install, /IF NOT EXISTS|CREATE SUBSCRIPTION|REPLICATION SLOT|COMMIT|ROLLBACK|ALTER SYSTEM|FOR ALL TABLES|CASCADE/);
});
test('requires private Admin PG17 context, exact genuine91 and captured native table metadata before creation', () => {
  for (const text of [install, observe]) for (const marker of [
    "current_database()='club_arena_qualification'", "current_user='supabase_admin' AND session_user='supabase_admin'",
    'inet_server_addr() IS NULL', "current_setting('search_path')='pg_catalog'", 'oid=10 AND rolname=current_user AND rolsuper',
    'count(*)=91', '07ccff1fbfc0665aee2027f75c40670b', '20261009120000', 'count(*)=8', 'count(*)=7',
    "pg_get_partkeydef(c.oid)='RANGE (inserted_at)'", 'r.prattrs IS NULL AND r.prqual IS NULL',
    'pg_catalog.pg_publication_namespace', 'p.pubowner=10', 'NOT p.puballtables', 'NOT p.pubviaroot', 'count(*)=1'
  ]) assert.ok(text.includes(marker), marker);
  for (const token of ['CONTEXT', 'PREIMAGE', 'POSTIMAGE']) assert.ok(install.includes(`FIXTURE_REALTIME_PUBLICATION_${token}_REQUIRED`));
  assert.ok(install.indexOf("OR EXISTS(SELECT FROM pg_catalog.pg_publication") < install.indexOf('CREATE PUBLICATION'));
  assert.ok(install.includes('OR EXISTS(SELECT 1 FROM realtime.messages)'));
  assert.match(observe, /AS realtime_captured_publication_exact$/);
  assert.doesNotMatch(observe, /\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/);
});
test('binds the captured PUBLICATION TABLE identity rather than confusing its key hash with SQL bytes', async () => {
  const { createHash } = await import('node:crypto');
  const key = JSON.stringify(['PUBLICATION TABLE', 'realtime', 'supabase_realtime_messages_publication messages']);
  assert.equal(createHash('sha256').update(key).digest('hex'), 'cd25832a98aadac5fd1b9ea5885fcde5c33f60a04ce345d165c17b5a24b8ba9b');
  assert.ok(install.includes('ADD TABLE ONLY realtime.messages'));
});
