import { renderSequenceDefaultAclOrderSql } from '../fixture/schema-restore-owner.mjs';
import { assertSchemaOnly, dumpObjects, schemaHash } from '../fixture/schema-compose.mjs';

// These literal contexts are fixture implementation, never archive-selected SQL.
const load = "LOAD 'supautils';\n";
const enter = 'SET LOCAL ROLE postgres;\n';
const leave = 'SET LOCAL ROLE fixture_schema_restore_owner;\n';
const limit = 128 * 1024 * 1024;

export function renderSchemaRestorePlan(sql, {roleCatalogue} = {}) {
  try {
    if (typeof sql !== 'string' || Buffer.byteLength(sql) === 0 || Buffer.byteLength(sql) > limit)
      throw new Error();
    assertSchemaOnly(sql);
    const parsed = dumpObjects(sql);
    if (!/^(?:--\r?\n)?-- PostgreSQL database dump\r?\n/.test(parsed.prefix) ||
        !/^-- PostgreSQL database dump complete(?:\r?\n|$)/.test(parsed.footer))
      throw new Error();
    // parts retain archive stream settings as well as every exact raw object
    // byte. No definition, owner command, body, comment or footer is rewritten.
    const original = parsed.prefix + parsed.objects.flatMap(object => object.parts)
      .map(part => part.text).join('') + parsed.footer;
    if (original !== sql) throw new Error();
    const sequenceBlocks = parsed.objects.filter(object => object.type === 'DEFAULT ACL' && object.name === 'DEFAULT PRIVILEGES FOR SEQUENCES');
    const defaults = sequenceBlocks.length ? renderSequenceDefaultAclOrderSql(roleCatalogue) : null;
    if (defaults) {
      const sourceKeys = sequenceBlocks.map(object => JSON.stringify([object.owner,object.schema === '-' ? 'GLOBAL' : object.schema])).sort();
      const expectedKeys = defaults.sequenceRows.map(row => JSON.stringify([row.creator,row.schema])).sort();
      if (JSON.stringify(sourceKeys) !== JSON.stringify(expectedKeys)) throw new Error();
      // DEFAULT ACLs must remain after every object that they could affect.
      const first = parsed.objects.findIndex(object => sequenceBlocks.includes(object));
      if (parsed.objects.slice(first).some(object => !['DEFAULT ACL','EVENT TRIGGER'].includes(object.type))) throw new Error();
    }
    let expectedPostgresEvents = 0;
    for (const object of parsed.objects) {
      if (object.type === 'EVENT TRIGGER' &&
          (object.schema !== '-' || !['postgres', 'supabase_admin'].includes(object.owner)))
        throw new Error();
      if (object.type === 'EVENT TRIGGER' && object.owner === 'postgres') expectedPostgresEvents++;
    }
    const extraBytes = expectedPostgresEvents * Buffer.byteLength(enter + leave) +
      (expectedPostgresEvents ? Buffer.byteLength(load) : 0);
    if (Buffer.byteLength(sql) + extraBytes > limit) throw new Error();
    let loaded = false;
    let postgresEvents = 0;
    const applied = [parsed.prefix, ...(defaults ? [defaults.begin] : [])];
    for (const object of parsed.objects) {
      const postgresEvent = object.type === 'EVENT TRIGGER' && object.owner === 'postgres';
      if (postgresEvent) {
        if (!loaded) { applied.push(load); loaded = true; }
        applied.push(enter);
        postgresEvents++;
      }
      for (const part of object.parts) applied.push(part.text);
      if (postgresEvent) applied.push(leave);
    }
    if (defaults) applied.push(defaults.end);
    applied.push(parsed.footer);
    const result = applied.join('');
    if (Buffer.byteLength(result) > limit) throw new Error();
    return {
      sql: result,
      receipt: Object.freeze({
        version: 1,
        scope: 'isolated-schema-restore-plan',
        original_sha256: schemaHash(sql),
        applied_sha256: schemaHash(result),
        object_count: parsed.objects.length,
        postgres_event_trigger_count: postgresEvents,
        context_switches: postgresEvents * 2,
        ...(defaults ? {deferred_sequence_default_acl_blocks: sequenceBlocks.length} : {}),
      }),
    };
  } catch {
    throw new Error('SCHEMA_RESTORE_PLAN_REFUSED');
  }
}
