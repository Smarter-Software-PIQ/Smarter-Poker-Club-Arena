/**
 * A SATELLITE SETTLEMENT ENTRYPOINT CARRIES ITS OWN DEADLINE (2026-11-18)
 *
 * PostgREST applies the statement_timeout of the function it is asked to call,
 * not of functions that one calls in turn. The engine sends every durable
 * terminal request (tournament finish and satellite qualifiers) straight to an
 * entrypoint; an entrypoint with no declared statement_timeout runs under
 * service_role's 8 s. fn_execute_capped_satellite_terminal_request declared
 * none, so qualifier settlement timed out (204 refusals in 12 h, max 7,937 ms),
 * held the qualifier boundary, darkened the event and stopped MTT play
 * (incidents 12edc9a0, 5968b285, 46b78962, 65660ecc).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const migrations = join(root, 'supabase/migrations');

function engineEntrypoints(): string[] {
  const src = readFileSync(join(root, 'server/src/tournament/terminalDurableRequest.ts'), 'utf8');
  return [...new Set([...src.matchAll(/'(fn_[a-z_]*terminal_request)'/g)].map((m) => m[1]))];
}

/** Latest declared statement_timeout per function across ordered migrations. */
function declaredTimeout(fn: string): string | null {
  let timeout: string | null = null;
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(migrations, file), 'utf8');
    const create = new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]*?\\$(?:function|body|fn|\\w*)\\$`,
      'g'
    );
    for (const m of sql.matchAll(create)) {
      const t = /statement_timeout\s*(?:TO|=)\s*'([^']+)'/i.exec(m[0]);
      timeout = t ? t[1] : null;
    }
    const alter = new RegExp(
      `ALTER FUNCTION public\\.${fn}\\([^)]*\\)\\s+SET statement_timeout\\s*(?:TO|=)\\s*'([^']+)'`,
      'g'
    );
    for (const m of sql.matchAll(alter)) timeout = m[1];
  }
  return timeout;
}

describe('a satellite settlement entrypoint carries its own deadline', () => {
  it('names the capped qualifier executor among the engine entrypoints', () => {
    expect(engineEntrypoints()).toContain('fn_execute_capped_satellite_terminal_request');
  });

  it('the capped qualifier executor declares the same 45 s as the request it runs', () => {
    expect(declaredTimeout('fn_execute_tournament_terminal_request')).toBe('45s');
    expect(declaredTimeout('fn_execute_capped_satellite_terminal_request')).toBe('45s');
  });

  it('the migration also bounds its lock wait like its siblings', () => {
    const sql = readFileSync(
      join(migrations, '20261118233000_the_capped_satellite_executor_carries_its_own_deadline.sql'),
      'utf8'
    );
    expect(sql).toMatch(
      /ALTER FUNCTION public\.fn_execute_capped_satellite_terminal_request\(uuid,uuid\)\s+SET lock_timeout = '8s'/
    );
  });
});
