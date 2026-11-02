// Captured deployment publication configuration, not an upstream migration.
// The caller owns the private Admin transaction and rollback; no worker starts.
import { realtimeCapturedAclObservationSql } from './realtime-captured-acls.mjs';

const name = 'supabase_realtime_messages_publication';
const context = `current_database()='club_arena_qualification'
  AND inet_server_addr() IS NULL AND current_user='supabase_admin' AND session_user='supabase_admin'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('search_path')='pg_catalog'
  AND EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
  AND to_regnamespace('_realtime') IS NULL`;
const native = `(SELECT realtime_captured_acl_exact FROM (${realtimeCapturedAclObservationSql}) native)`;
const publication = `EXISTS(SELECT FROM pg_catalog.pg_publication p
  WHERE p.pubname='${name}' AND p.pubowner=10 AND NOT p.puballtables
    AND p.pubinsert AND p.pubupdate AND p.pubdelete AND p.pubtruncate AND NOT p.pubviaroot
    AND NOT EXISTS(SELECT FROM pg_catalog.pg_publication_namespace n WHERE n.pnpubid=p.oid)
    AND (SELECT count(*)=1 AND bool_and((r.prrelid='realtime.messages'::regclass
      AND r.prattrs IS NULL AND r.prqual IS NULL) IS TRUE)
      FROM pg_catalog.pg_publication_rel r WHERE r.prpubid=p.oid))`;
export const realtimeCapturedPublicationObservationSql = `SELECT (${context}) AND ${native}
  AND ${publication} AS realtime_captured_publication_exact`;
export const realtimeCapturedPublicationInstallSql = `DO $realtime_captured_publication$
BEGIN
  IF (${context}) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_PUBLICATION_CONTEXT_REQUIRED'; END IF;
  IF ${native} IS DISTINCT FROM TRUE
    OR EXISTS(SELECT FROM pg_catalog.pg_publication WHERE pubname='${name}')
    OR EXISTS(SELECT 1 FROM realtime.messages)
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_PUBLICATION_PREIMAGE_REQUIRED'; END IF;
  CREATE PUBLICATION ${name}
    WITH (publish='insert, update, delete, truncate', publish_via_partition_root=false);
  ALTER PUBLICATION ${name} ADD TABLE ONLY realtime.messages;
  IF ${publication} IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'FIXTURE_REALTIME_PUBLICATION_POSTIMAGE_REQUIRED'; END IF;
END $realtime_captured_publication$;`;
