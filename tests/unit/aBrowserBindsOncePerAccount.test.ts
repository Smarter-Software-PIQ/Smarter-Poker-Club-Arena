/**
 * A BROWSER BINDS ONCE PER ACCOUNT (2026-11-26).
 *
 * ca_browser_bindings was keyed on browser_token alone while every reader
 * looks a binding up by (browser_token, user_id). When a second account signed
 * in on a browser that the first account had already bound, the plain INSERT
 * in ca_claim_active_login hit ca_browser_bindings_pkey (134 production
 * errors in 24 hours, two browsers), the client read the refusal as a
 * transport failure and retried on every auth event. ca_resolve_pairing's
 * ON CONFLICT (browser_token) went the other way and silently moved the first
 * account's binding to the second.
 *
 * These cases read the LATEST definition of each writer across every
 * migration, so a later migration that brings back the old shape fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = join(resolve(__dirname, '../..'), 'supabase/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

const WRITERS = ['ca_claim_active_login', 'ca_register_new_device', 'ca_resolve_pairing'] as const;

/** The body of the last CREATE OR REPLACE of public.<name>, with its file. */
function latestBody(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'g');
  for (const file of files) {
    const sql = read(file);
    for (const m of sql.matchAll(head)) {
      const start = m.index ?? 0;
      const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start));
      if (!tag) continue;
      const open = sql.indexOf(tag[1], start) + tag[1].length;
      const close = sql.indexOf(tag[1], open);
      found = { file, body: sql.slice(open, close) };
    }
  }
  expect(found, `public.${name} is defined in some migration`).not.toBeNull();
  return found as { file: string; body: string };
}

/** Each INSERT INTO public.ca_browser_bindings statement in a body, to its semicolon. */
function bindingInserts(body: string): string[] {
  const out: string[] = [];
  const re = /INSERT INTO public\.ca_browser_bindings\b/g;
  for (const m of body.matchAll(re)) {
    const start = m.index ?? 0;
    out.push(body.slice(start, body.indexOf(';', start) + 1));
  }
  return out;
}

describe('a browser binds once per account', () => {
  it('the latest primary key of ca_browser_bindings is (browser_token, user_id)', () => {
    let latest: string | null = null;
    const re = /ADD CONSTRAINT ca_browser_bindings_pkey PRIMARY KEY \(([^)]*)\)/g;
    for (const file of files) for (const m of read(file).matchAll(re)) latest = m[1];
    expect(latest?.replace(/\s+/g, '')).toBe('browser_token,user_id');
  });

  it('every writer keys its binding insert on (browser_token, user_id)', () => {
    let inserts = 0;
    for (const name of WRITERS) {
      const { file, body } = latestBody(name);
      const stmts = bindingInserts(body);
      expect(stmts.length, `${name} (${file}) writes a binding`).toBeGreaterThan(0);
      for (const stmt of stmts) {
        inserts += 1;
        expect(stmt.replace(/\s+/g, ' '), `${name} (${file})`).toMatch(
          /ON CONFLICT \(browser_token, ?user_id\) DO UPDATE/
        );
      }
    }
    expect(inserts).toBeGreaterThanOrEqual(3);
  });

  it('no writer moves another account binding to the caller', () => {
    for (const name of WRITERS) {
      const { file, body } = latestBody(name);
      for (const stmt of bindingInserts(body)) {
        const update = stmt.slice(stmt.indexOf('DO UPDATE'));
        expect(update, `${name} (${file})`).not.toMatch(/\buser_id\s*=/);
      }
    }
  });

  it('a returning account refreshes only its own binding', () => {
    const { file, body } = latestBody('ca_claim_active_login');
    const updates = [...body.matchAll(/UPDATE public\.ca_browser_bindings[^;]*;/g)].map((m) => m[0]);
    expect(updates.length, file).toBeGreaterThan(0);
    for (const u of updates) expect(u.replace(/\s+/g, ' '), file).toMatch(/AND user_id\s*=\s*v_uid/);
  });
});
