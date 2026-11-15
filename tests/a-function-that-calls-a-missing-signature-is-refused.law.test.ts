/**
 * A PL/pgSQL FUNCTION THAT CALLS A SIGNATURE THAT DOES NOT EXIST IS REFUSED
 * WHEN ITS TRANSACTION COMMITS
 *
 * 2026-11-14: 20261114072509 made public.fn_mystery_bounty_seed call
 * fn_mystery_sealed_ladder_for_open(uuid, integer, bigint) with a sum(bigint),
 * which is numeric. Postgres does not resolve a PL/pgSQL body at CREATE, so the
 * migration installed, every mystery activation then raised 42883, and two live
 * mystery bounty MTTs stopped dealing until 20261115001336 (#10884). The
 * migration's own @live-proof checked that the call text was present; nothing
 * asked whether it resolved.
 *
 * Now the database asks, and every link of that is pinned here so removing one
 * turns this file red instead of quietly letting the next unresolved call in:
 *   1. plpgsql_check is installed, and the one helper asks it for 42883 only,
 *      with the check mode forced on (every role has it disabled, and a
 *      disabled check answers "nothing found" without looking);
 *   2. the helper skips only what it cannot judge without guessing, and fails
 *      open loudly, never silently;
 *   3. the event trigger queues every function created or altered in public and
 *      smarter_private (not Supabase's schemas, not pg_temp, not extensions);
 *   4. the check runs at COMMIT through a deferred constraint trigger, so a
 *      forward reference inside one migration is fine, and it RAISEs 42883;
 *   5. the override is a reason, not a switch, and every use is recorded in an
 *      append-only table;
 *   6. nothing later drops or disables either trigger.
 */
import { describe, it, expect } from 'vitest';
import { migrationFiles, readMigration } from './helpers/migrations';

const HELPER = 'smarter_private.fn_ca_unresolved_function_calls';
const CHECK = 'smarter_private.fn_ca_function_calls_must_resolve';
const QUEUE_FN = 'smarter_private.fn_ca_queue_function_for_resolution';
const EVENT_TRIGGER = 'ca_function_calls_must_resolve_at_commit';
const CONSTRAINT_TRIGGER = 'ca_function_calls_must_resolve';
const INSTALLED_BY = '20261115020406';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const declares = (fn: string) =>
  new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${escape(fn)}\\s*\\(`, 'i');

/** The migration in force for a smarter_private function: the last to declare it. */
function latestDeclaring(fn: string): { name: string; sql: string } {
  const hits = migrationFiles().filter((f) => declares(fn).test(readMigration(f)));
  if (hits.length === 0) throw new Error(`no migration declares ${fn}`);
  const name = hits[hits.length - 1];
  return { name, sql: readMigration(name) };
}

/** The declaration header (name through AS) and the dollar-quoted body of fn. */
function declaration(sql: string, fn: string): { header: string; body: string } {
  const all = [...sql.matchAll(new RegExp(declares(fn).source, 'gi'))];
  const at = all.at(-1)?.index;
  if (at === undefined) throw new Error(`${fn} is not declared here`);
  const rest = sql.slice(at);
  const quote = /\bAS\s+(\$\w*\$)/i.exec(rest);
  if (!quote) throw new Error(`${fn} has no dollar-quoted body`);
  const start = quote.index + quote[0].length;
  const end = rest.indexOf(quote[1], start);
  if (end < 0) throw new Error(`${fn} has no closing dollar quote`);
  return { header: rest.slice(0, quote.index), body: rest.slice(start, end) };
}

describe('a function that calls a missing signature is refused at commit', () => {
  it('the checker is installed and one helper asks it for 42883 only, with the mode forced on', () => {
    const { name, sql } = latestDeclaring(HELPER);
    expect(name >= INSTALLED_BY).toBe(true);
    expect(
      migrationFiles().some(
        (f) =>
          f >= INSTALLED_BY &&
          /CREATE EXTENSION IF NOT EXISTS plpgsql_check\b/.test(readMigration(f))
      )
    ).toBe(true);
    const { header, body } = declaration(sql, HELPER);
    expect(header).toMatch(/\bSTABLE\b/);
    // plpgsql_check.mode = disabled on every role makes an explicit check
    // return no rows for a function that plainly calls a missing signature.
    expect(header).toContain("SET plpgsql_check.mode = 'by_function'");
    expect(body).toContain('plpgsql_check_function_tb($1, fatal_errors => false');
    expect(body).toContain("c.sqlstate = '42883'");
  });

  it('it skips only what it cannot judge, and fails open loudly', () => {
    const { body } = declaration(latestDeclaring(HELPER).sql, HELPER);
    expect(body).toContain("v_lang IS DISTINCT FROM 'plpgsql'");
    expect(body).toContain("'pg_catalog.trigger'::pg_catalog.regtype");
    expect(body).toContain("'pg_catalog.event_trigger'::pg_catalog.regtype");
    // Dynamic SQL is deliberately deferred resolution; static calls are judged.
    expect(body).toContain("f->>'statement' IN ('EXECUTE', 'FOR over EXECUTE statement')");
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it('the event trigger queues every function in public and smarter_private, nothing else', () => {
    const { sql } = latestDeclaring(QUEUE_FN);
    const { header, body } = declaration(sql, QUEUE_FN);
    expect(header).toMatch(/RETURNS event_trigger/);
    expect(body).toContain("c.object_type IN ('function', 'procedure')");
    expect(body).toContain("c.schema_name IN ('public', 'smarter_private')");
    expect(body).toContain('NOT c.in_extension');
    expect(body).toContain('INSERT INTO smarter_private.ca_function_resolution_queue');
    // An earlier SET CONSTRAINTS ALL IMMEDIATE must not judge a forward reference early.
    expect(body).toContain(`SET CONSTRAINTS smarter_private.${CONSTRAINT_TRIGGER} DEFERRED`);
    const trigger = new RegExp(
      `CREATE EVENT TRIGGER ${EVENT_TRIGGER}\\s+ON ddl_command_end\\s+WHEN TAG IN \\(([^)]*)\\)\\s+EXECUTE FUNCTION ${escape(QUEUE_FN)}\\(\\)`
    ).exec(sql);
    expect(trigger).not.toBeNull();
    for (const tag of ['CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE PROCEDURE', 'ALTER PROCEDURE'])
      expect(trigger![1]).toContain(`'${tag}'`);
  });

  it('the check runs at COMMIT, consumes its row, and refuses with 42883', () => {
    const { sql } = latestDeclaring(CHECK);
    expect(sql).toMatch(
      new RegExp(
        `CREATE CONSTRAINT TRIGGER ${CONSTRAINT_TRIGGER}\\s+AFTER INSERT ON smarter_private\\.ca_function_resolution_queue\\s+DEFERRABLE INITIALLY DEFERRED\\s+FOR EACH ROW EXECUTE FUNCTION ${escape(CHECK)}\\(\\)`
      )
    );
    const { body } = declaration(sql, CHECK);
    expect(body).toContain(
      'DELETE FROM smarter_private.ca_function_resolution_queue q WHERE q.id = NEW.id'
    );
    expect(body).toContain(`FROM ${HELPER}(v_fn)`);
    expect(body).toContain("ERRCODE = '42883'");
    expect(body).toContain('2026-11-14');
    // The queue is a cursor table: no foreign key (CLAUDE.md section 2 rule 7).
    const table = /CREATE TABLE smarter_private\.ca_function_resolution_queue \(([\s\S]*?)\);/.exec(
      sql
    );
    expect(table).not.toBeNull();
    expect(table![1]).not.toMatch(/REFERENCES/i);
  });

  it('the override is a reason, not a switch, and every use is recorded append-only', () => {
    const { sql } = latestDeclaring(CHECK);
    const { body } = declaration(sql, CHECK);
    expect(body).toContain("current_setting('ca.function_resolution_override', true)");
    expect(body).toContain(
      "IN ('on', 'off', 'true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0')"
    );
    expect(body).toContain('INSERT INTO smarter_private.ca_function_resolution_overrides');
    expect(sql).toMatch(
      /BEFORE UPDATE OR DELETE ON smarter_private\.ca_function_resolution_overrides\s+FOR EACH ROW EXECUTE FUNCTION smarter_private\.fn_ca_function_resolution_overrides_are_append_only\(\)/
    );
    expect(sql).toMatch(/BEFORE TRUNCATE ON smarter_private\.ca_function_resolution_overrides/);
  });

  it('its live proof names both triggers, and nothing later drops or disables either', () => {
    const { sql } = latestDeclaring(CHECK);
    const proofs = [...sql.matchAll(/^-- @live-proof: (.*)$/gm)].map((m) => m[1]);
    expect(
      proofs.some((p) => p.includes(`'${EVENT_TRIGGER}'`) && p.includes(`'${CONSTRAINT_TRIGGER}'`))
    ).toBe(true);
    for (const f of migrationFiles().filter((n) => n >= INSTALLED_BY)) {
      const text = readMigration(f).replace(/--[^\n]*/g, '');
      expect(text, f).not.toMatch(new RegExp(`ALTER EVENT TRIGGER ${EVENT_TRIGGER} DISABLE`, 'i'));
      expect(text, f).not.toMatch(/ca_function_resolution_queue\s+DISABLE TRIGGER/i);
      expect(text, f).not.toMatch(
        new RegExp(`DROP TRIGGER (IF EXISTS )?${CONSTRAINT_TRIGGER}\\b`, 'i')
      );
      const drops =
        text.match(new RegExp(`DROP EVENT TRIGGER (IF EXISTS )?${EVENT_TRIGGER}\\b`, 'gi')) ?? [];
      const creates =
        text.match(new RegExp(`CREATE EVENT TRIGGER ${EVENT_TRIGGER}\\b`, 'gi')) ?? [];
      expect(creates.length, f).toBeGreaterThanOrEqual(drops.length);
    }
  });
});
