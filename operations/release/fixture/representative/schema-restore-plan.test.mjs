import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSchemaRestorePlan } from '../../native/schema-restore-plan.mjs';
import { dumpObjects, schemaHash } from '../schema-compose.mjs';
const prefix = '-- PostgreSQL database dump\nSET statement_timeout = 0;\n';
const footer = '-- PostgreSQL database dump complete\n';
const object = (name, type, schema, owner, body) =>
  `-- Name: ${name}; Type: ${type}; Schema: ${schema}; Owner: ${owner}\n--\n\n${body}\n\n`;
const functionBlock = object('f()', 'FUNCTION', 'public', 'postgres', `CREATE FUNCTION public.f() RETURNS event_trigger LANGUAGE plpgsql AS $body$\nBEGIN\n-- Name: fake; Type: EVENT TRIGGER; Schema: -; Owner: postgres\nPERFORM 'SET LOCAL ROLE postgres;';\n/* nested /* block */\n-- Name: fake2; Type: EVENT TRIGGER; Schema: -; Owner: other\n*/\nEND\n$body$;\nALTER FUNCTION public.f() OWNER TO postgres;`);
const event = (owner = 'postgres', name = 'owned') => object(name, 'EVENT TRIGGER', '-', owner,
  `CREATE EVENT TRIGGER ${name} ON ddl_command_end EXECUTE FUNCTION public.f();\nALTER EVENT TRIGGER ${name} OWNER TO ${owner};`);
const table = object('kept', 'TABLE', 'public', 'postgres', 'CREATE TABLE public.kept (id integer);');
const load = "LOAD 'supautils';\n";
const enter = 'SET LOCAL ROLE postgres;\n';
const leave = 'SET LOCAL ROLE fixture_schema_restore_owner;\n';
test('wraps only actual PG-owned event blocks, preserves every byte/order and emits no private receipt fields', () => {
  const admin = event('supabase_admin', 'admin_owned');
  const pg1 = event();
  const pg2 = event('postgres', 'second');
  const original = prefix + functionBlock + admin + pg1 + table + pg2 + footer;
  const plan = renderSchemaRestorePlan(original);
  assert.equal(plan.sql, prefix + functionBlock + admin + load + enter + pg1 + leave + table + enter + pg2 + leave + footer);
  assert.deepEqual(plan.receipt, {version: 1, scope: 'isolated-schema-restore-plan',
    original_sha256: schemaHash(original), applied_sha256: schemaHash(plan.sql),
    object_count: 5, postgres_event_trigger_count: 2, context_switches: 4});
  assert.equal(plan.sql.split(load).length - 1, 1);
  assert.deepEqual(Object.keys(plan).sort(), ['receipt', 'sql']);
  assert.ok(!JSON.stringify(plan.receipt).includes('admin_owned'));
  const before = dumpObjects(original), after = dumpObjects(plan.sql);
  // Inserted context becomes part of adjacent raw parser ranges; the original
  // exact ordered content is asserted above, never normalized or reserialized.
  assert.equal(before.objects.length, after.objects.length);
});
test('zero PG event blocks leave complete schema bytes unchanged without loading a library', () => {
  for (const body of [functionBlock + table, event('supabase_admin') + table]) {
    const sql = prefix + body + footer;
    const plan = renderSchemaRestorePlan(sql);
    assert.equal(plan.sql, sql);
    assert.equal(plan.receipt.context_switches, 0);
    assert.equal(plan.receipt.postgres_event_trigger_count, 0);
  }
});
test('preserves pg_dump stream settings and escaped-string fake headers verbatim', () => {
  const settings = "SET default_tablespace = '';\n\nSET default_table_access_method = heap;\n\n";
  const escaped = object('s()', 'FUNCTION', 'public', 'postgres', String.raw`SELECT E'escaped\'
-- Name: impostor; Type: EVENT TRIGGER; Schema: -; Owner: other
still literal';`);
  const pg = event() + settings;
  const original = prefix + escaped + pg + table + footer;
  const plan = renderSchemaRestorePlan(original);
  assert.equal(plan.sql, prefix + escaped + load + enter + pg + leave + table + footer);
  assert.equal(plan.receipt.object_count, 3);
  assert.equal(plan.receipt.postgres_event_trigger_count, 1);
  assert.equal(dumpObjects(original).objects[1].parts.filter(x => x.stream).length, 2);
});
test('refuses unknown event owners/schema, invalid dump boundaries/data and non-string input without raw content', () => {
  for (const sql of [prefix + event('foreign') + footer,
    prefix + event().replace('Schema: -;', 'Schema: public;') + footer,
    prefix + object('private-name', 'TABLE DATA', 'public', 'postgres', 'COPY private_table;') + footer,
    prefix + object('broken()', 'FUNCTION', 'public', 'postgres', 'SELECT $unclosed$') + footer,
    prefix + event(), event() + footer, null, '', 42]) {
    assert.throws(() => renderSchemaRestorePlan(sql), error => error.message === 'SCHEMA_RESTORE_PLAN_REFUSED');
  }
});

test('preserves CRLF archive bytes and event definition owner commands without rewriting', () => {
  const raw = (prefix + functionBlock + event() + footer).replaceAll('\n', '\r\n');
  const plan = renderSchemaRestorePlan(raw);
  const block = event().replaceAll('\n', '\r\n');
  assert.equal(plan.sql, prefix.replaceAll('\n', '\r\n') + functionBlock.replaceAll('\n', '\r\n') + load + enter + block + leave + footer.replaceAll('\n', '\r\n'));
  assert.ok(plan.sql.includes('ALTER EVENT TRIGGER owned OWNER TO postgres;\r\n'));
  assert.equal(plan.receipt.original_sha256, schemaHash(raw));
});
