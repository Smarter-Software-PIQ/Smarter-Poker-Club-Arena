/**
 * AN ENGINE-INERT MIGRATION DOES NOT STALE A CERTIFICATE (2026-11-26, O33).
 *
 * The 13:00 Chicago cutover of 2026-11-26 was lost: the only certified candidate, 13bce958d4c3, was refused with
 * "Backup copy lacks installed migration 20261126011318, 20261126014018, 20261126014434, 20261126064723" (issue
 * #11599). Each of the four is BEGIN, SET LOCAL lock_timeout, fn_ca_horse_option_register(...) calls with literal
 * arguments, COMMIT: one row of public.ca_horse_option_whitelist per call, a table no engine reads.
 * server/scripts/engine-release-installed-migrations.py now leaves such a version out of the comparable set on both
 * sides. This law pins the class (narrow, literal-only), the judge's behaviour, and the PREMISE: if the engine ever
 * starts reading the whitelist, or a database function the engine calls starts depending on more than an option's
 * kind, this law fails and the carve-out must be removed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const HELPER = join(ROOT, 'server/scripts/engine-release-installed-migrations.py');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const INCIDENT = ['20261126011318', '20261126014018', '20261126014434', '20261126064723'];

function migrationFile(version: string): string {
  const name = readdirSync(MIGRATIONS).find((f) => f.startsWith(version + '_') && f.endsWith('.sql'));
  if (!name) throw new Error('no migration file for ' + version);
  return join(MIGRATIONS, name);
}

/** engine_inert() of each text, through the real helper. */
function classify(texts: string[]): boolean[] {
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location('m', ${JSON.stringify(HELPER)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.engine_inert(t) for t in json.load(sys.stdin)]))',
  ].join('\n');
  const run = spawnSync('python3', ['-B', '-c', script], { input: JSON.stringify(texts), encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__') walk(path, out);
    } else if (/\.(ts|js|mjs|cjs)$/.test(name) && !/\.test\.|\.spec\./.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** {function name: [file, body]} of the newest definition of every public function across the migrations. */
function newestDefinitions(): Map<string, [string, string]> {
  const latest = new Map<string, [string, string]>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = head.exec(sql))) {
      const rest = sql.slice(match.index + match[0].length);
      const tag = /AS\s+(\$[a-z_]*\$)/i.exec(rest);
      if (!tag) continue;
      const start = tag.index + tag[0].length;
      const end = rest.indexOf(tag[1], start);
      latest.set(match[1].toLowerCase(), [file, rest.slice(start, end < 0 ? undefined : end)]);
    }
  }
  return latest;
}

describe('an engine-inert migration does not stale a certificate', () => {
  it('the four files the 13:00 selection refused classify engine-inert', () => {
    expect(classify(INCIDENT.map((v) => readFileSync(migrationFile(v), 'utf8')))).toEqual([true, true, true, true]);
  });

  it('every mutation outside the literal shapes classifies NOT inert', () => {
    const base = readFileSync(migrationFile(INCIDENT[0]), 'utf8');
    const call = base.split('\n').find((l) => l.startsWith('SELECT public.fn_ca_horse_option_register('))!;
    expect(call).toBeTruthy();
    const mutations: Record<string, string> = {
      'an extra UPDATE': base.replace('COMMIT;', "UPDATE public.ca_horse_style_switch SET state = 'on';\nCOMMIT;"),
      'a CREATE': base.replace('COMMIT;', 'CREATE TABLE public.zz_x (id int);\nCOMMIT;'),
      'a non-literal argument': base.replace(call, call.replace(/'shadow', '/, "'shadow', 'x' || '")),
      'a subquery argument': base.replace(call, call.replace(/, false, /, ', (SELECT true), ')),
      'an unknown function': base.replace(call, call.replace('fn_ca_horse_option_register', 'fn_ca_horse_option_unregister')),
      'a DO block': base.replace('COMMIT;', "DO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;"),
      'two statements on one line': base.replace(call, call + ' DELETE FROM public.ca_horse_option_whitelist;'),
      'a trailing comment': base.replace(call, call + ' -- note'),
      'a block comment': base.replace(call, '/* ' + call + ' */'),
      'a quote inside a literal': base.replace(call, call.replace(/\('([A-Za-z]+)'/, "('$1'';'")),
      'no BEGIN': base.replace('BEGIN;', ''),
      'no COMMIT': base.replace('COMMIT;', ''),
      'no call at all': base.replace(/^SELECT public\.fn_ca_horse_option_register\(.*$/gm, ''),
      'a longer timeout setting': base.replace(/SET LOCAL lock_timeout = '3s';/, "SET LOCAL statement_timeout = '0';"),
    };
    for (const [label, text] of Object.entries(mutations)) {
      expect(text, label).not.toBe(base);
    }
    const verdicts = classify(Object.values(mutations));
    Object.keys(mutations).forEach((label, i) => expect(verdicts[i], label).toBe(false));
  });

  it('the judge passes a copy lacking only inert versions and refuses when a non-inert one is also missing', () => {
    const run = spawnSync('python3', ['-B', join(ROOT, 'tests/operations/backup-installed-migrations.test.py'),
      'EngineInertMigration'], { encoding: 'utf8', timeout: 170000 });
    expect(run.status, run.stderr + run.stdout).toBe(0);
    expect(run.stderr).toMatch(/Ran [1-9][0-9]* tests?/);
  });

  it('PREMISE: no engine code reads public.ca_horse_option_whitelist or calls a function that changes it', () => {
    const exempt = new Set([join(ROOT, 'server/src/engine/HorseOptionSwitchMigrationLists.ts')]);
    const readers: string[] = [];
    for (const file of walk(join(ROOT, 'server/src'))) {
      if (exempt.has(file)) continue;
      const code = withoutComments(readFileSync(file, 'utf8'));
      if (/ca_horse_option_whitelist|fn_ca_horse_option_(register|allow_shadow|unlock|unregister|switch_states)\b/.test(code)) {
        readers.push(file);
      }
    }
    expect(readers).toEqual([]);
  });

  it('PREMISE: the database functions that read the whitelist are the known set, and the engine reaches them only by kind', () => {
    const latest = newestDefinitions();
    const reading = [...latest.entries()]
      .filter(([, [, body]]) => /ca_horse_option_whitelist|fn_ca_horse_option_switch_states/.test(body))
      .map(([name]) => name)
      .sort();
    expect(reading).toEqual([
      'fn_ca_horse_option_allow_shadow',
      'fn_ca_horse_option_register',
      'fn_ca_horse_option_switch_clear',
      'fn_ca_horse_option_switch_effective',
      'fn_ca_horse_option_switch_record_evidence',
      'fn_ca_horse_option_switch_row_fits',
      'fn_ca_horse_option_switch_set',
      'fn_ca_horse_option_switch_states',
      'fn_ca_horse_option_unlock',
      'fn_ca_horse_option_unregister',
      'fn_ca_horse_style_switch_effective',
    ]);
    // The engine calls (outside comments) only the two effective reads among them.
    const engineCode = walk(join(ROOT, 'server/src'))
      .filter((f) => !f.endsWith('HorseOptionSwitchMigrationLists.ts'))
      .map((f) => withoutComments(readFileSync(f, 'utf8')))
      .join('\n');
    const called = reading.filter((name) => new RegExp(`\\b${name}\\b`).test(engineCode)).sort();
    expect(called).toEqual(['fn_ca_horse_option_switch_effective', 'fn_ca_horse_style_switch_effective']);
    // Each uses the whitelist only through the option's kind: switch_states contains 'canary' only for a style option.
    for (const name of called) {
      const body = latest.get(name)![1];
      const uses = body.match(/fn_ca_horse_option_switch_states\([^)]*\)[^\n]*/g) ?? [];
      expect(uses.length, name).toBeGreaterThan(0);
      for (const use of uses) expect(use, name).toMatch(/^fn_ca_horse_option_switch_states\(s\.option\) @> ARRAY\['canary'\]/);
      expect(body, name).not.toMatch(/ca_horse_option_whitelist/);
    }
    const states = latest.get('fn_ca_horse_option_switch_states')![1];
    expect(states).toMatch(/WHEN w\.kind = 'style' THEN ARRAY\['off', 'shadow', 'canary', 'on'\]/);
    expect((states.match(/'canary'/g) ?? []).length).toBe(1);
    // A kind never changes once registered, so a register call cannot change either effective answer.
    expect(latest.get('fn_ca_horse_option_whitelist_guard')![1]).toMatch(/NEW\.option <> OLD\.option OR NEW\.kind <> OLD\.kind/);
    expect(latest.get('fn_ca_horse_option_register')![1]).toMatch(/IF v_row\.kind <> p_kind THEN\s+RAISE EXCEPTION/);
  });

  it('the selector, refresh-due and the cutover status read the engine-inert set; the certificate digest is unchanged', () => {
    const helper = readFileSync(HELPER, 'utf8');
    const selector = readFileSync(join(ROOT, 'scripts/ci/select-daily-engine.py'), 'utf8');
    expect(selector).toMatch(/inert = module\.inert_versions\('\.', control/);
    expect(selector).toMatch(/module\.judge\([^)]*, tree, inert\)/);
    expect(helper).toMatch(/due, why = refresh_due\(evidence, args\.copy_evidence_sha, production, due_tree, due_inert\)/);
    // The certificate still names the copy's own set; the cutover recognises it plus inert versions only.
    expect(helper).toMatch(/tree = tree_versions\(repo, sha, control\) if control else None\n    return digest\(comparable\(rows, window_versions\(repo, sha\), tree\)\), len\(rows\)/);
    expect(helper).toMatch(/inert = inert_versions\(repo, control, sha\) if control else frozenset\(\)/);
    expect(helper).toMatch(/left = inert_left_out\(production, inert, certified\) if now != certified else None/);
    // The selector never accepts a copy the cutover cannot recognise.
    expect(helper.match(/inert = bounded_inert\(inert, production\['migrations'\]\)/g)?.length).toBe(2);
    expect(helper).toMatch(/left out as engine-inert: /);
  });
});
