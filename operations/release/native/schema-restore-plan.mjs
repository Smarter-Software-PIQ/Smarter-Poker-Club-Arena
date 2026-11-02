import { assertSchemaOnly, dumpObjects, schemaHash } from '../fixture/schema-compose.mjs';

// These literal contexts are fixture implementation, never archive-selected SQL.
const load = "LOAD 'supautils';\n";
const enter = 'SET LOCAL ROLE postgres;\n';
const leave = 'SET LOCAL ROLE fixture_schema_restore_owner;\n';
const limit = 128 * 1024 * 1024;

export function renderSchemaRestorePlan(sql) {
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
    const applied = [parsed.prefix];
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
    applied.push(parsed.footer);
    const result = applied.join('');
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
      }),
    };
  } catch {
    throw new Error('SCHEMA_RESTORE_PLAN_REFUSED');
  }
}
