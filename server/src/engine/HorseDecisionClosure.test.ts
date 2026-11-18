/**
 * The decision closure is complete and sensitive (2026-11-08). A
 * closure-bound feature plan hashes exactly horseDecisionClosure(); these laws
 * keep that set equal to the import graph the TypeScript compiler reads from
 * the same entry points (completeness: no executed module can be left out),
 * and show that a change to any bound byte changes the binding (sensitivity).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  HORSE_DECISION_CLOSURE_ENTRIES,
  HORSE_DECISION_CLOSURE_EXTERNAL_INPUTS,
  HORSE_DECISION_CLOSURE_INDIRECT_LOADS,
  horseDecisionClosure,
  horseDecisionRuntimeSpecifiers,
  isHorseDecisionClosureRegistry,
} from './HorseDecisionClosure.js';
import { featureAuthorityClosure, runningFeatureSourcePaths } from './HorseFeatureAuthority.js';
import { HORSE_REFERENCE_DECISION_SOURCE_FILES } from './HorseReferenceDecisionSources.js';
import { FEATURE_ABLATION_REQUIRED_RUNTIME_FILES } from '../benchmark/FeatureAblationQualification.js';

const serverRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(path.join(serverRoot, rel));

/** Independent oracle: the compiler's AST, not the walker's scanner. */
function oracleSpecifiers(rel: string): string[] {
  const sf = ts.createSourceFile(rel, read(rel).toString(), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause;
      const typeOnly =
        !!c?.isTypeOnly ||
        (!!c &&
          !c.name &&
          !!c.namedBindings &&
          ts.isNamedImports(c.namedBindings) &&
          c.namedBindings.elements.length > 0 &&
          c.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) out.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      out.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.length === 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[1].getText(sf) === 'import.meta.url'
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.filter((s) => s.startsWith('.') && !s.endsWith('/'));
}
/**
 * Load sites whose target is computed, which no import scanner can follow:
 * `new URL(<non-literal>, import.meta.url)`, `new Worker(x)` unless x is a
 * literal `new URL('<path>', import.meta.url)`, any `createRequire(...)`, and a
 * non-literal `import(x)`. Sorted kinds, one per site.
 */
export function indirectLoadSites(rel: string, source: string): string[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const metaUrl = (n: ts.Node | undefined) => !!n && n.getText(sf) === 'import.meta.url';
  const literalUrl = (n: ts.Node | undefined) =>
    !!n &&
    ts.isNewExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'URL' &&
    !!n.arguments?.[0] &&
    ts.isStringLiteralLike(n.arguments[0]) &&
    metaUrl(n.arguments[1]);
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const [a, b] = node.arguments ?? [];
      if (node.expression.text === 'URL' && a && !ts.isStringLiteralLike(a) && metaUrl(b))
        out.push('url');
      if (node.expression.text === 'Worker' && !literalUrl(a)) out.push('worker');
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'createRequire')
        out.push('require');
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        !(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
      )
        out.push('import');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort();
}
function oracleClosure(): string[] {
  const seen = new Set<string>(),
    queue = [...HORSE_DECISION_CLOSURE_ENTRIES];
  while (queue.length) {
    const rel = queue.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.(?:ts|mjs|js)$/.test(rel)) continue;
    for (const spec of oracleSpecifiers(rel)) {
      let t = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!existsSync(path.join(serverRoot, t)) && t.endsWith('.js')) t = t.slice(0, -3) + '.ts';
      expect(existsSync(path.join(serverRoot, t)), `${spec} from ${rel}`).toBe(true);
      queue.push(t);
    }
  }
  for (const s of runningFeatureSourcePaths()) seen.add(s);
  return [...seen].filter((p) => !isHorseDecisionClosureRegistry(p)).sort();
}

describe('the decision closure', () => {
  const closure = featureAuthorityClosure(read);

  it('equals the import graph the compiler reads from the decision entry points', () => {
    expect(closure).toEqual(oracleClosure());
  });

  it('agrees with the compiler file by file (no scanner blind spot)', () => {
    for (const rel of closure.filter((p) => /\.(?:ts|mjs)$/.test(p))) {
      const mine = [...new Set(horseDecisionRuntimeSpecifiers(read(rel).toString()))].sort();
      const theirs = [...new Set(oracleSpecifiers(rel))].sort();
      expect(mine, rel).toEqual(theirs);
    }
  });

  it('contains every file admission and the qualification harness require', () => {
    for (const p of [
      ...HORSE_REFERENCE_DECISION_SOURCE_FILES,
      ...runningFeatureSourcePaths(),
      ...FEATURE_ABLATION_REQUIRED_RUNTIME_FILES,
      ...HORSE_DECISION_CLOSURE_ENTRIES,
      // The thread every production decision runs on (spawned from a computed URL).
      'src/engine/horseDecision/worker.ts',
      'src/engine/HorseDecisionClosure.ts',
      'src/engine/HorseFeatureLiveDomain.ts',
      'src/benchmark/IncrementalPressureQualification.ts',
      'src/benchmark/IncrementalPressureDevelopment.ts',
    ])
      expect(closure, p).toContain(p);
    expect(closure.some((p) => /\.(?:test|spec)\.ts$/.test(p))).toBe(false);
    expect(closure.some(isHorseDecisionClosureRegistry)).toBe(false);
  });

  /**
   * 2026-11-14. The engine alert plumbing is operations code, not decision code. When client.ts imported the
   * telemetry gap alert, four alert files joined this closure, so any later alert edit would have moved the
   * decision policy digest and spent another lane's held-out qualification. The decision path reports through a
   * sink the main process injects (index.ts, setBrainTelemetryGapSink) and never imports an alert module.
   */
  it('holds no engine alert file', () => {
    const alertFile = /(?:^|\/)(?:engineAlert[A-Za-z]*|horseTelemetryGapAlert)\.ts$/;
    expect(closure.filter((p) => alertFile.test(p))).toEqual([]);
    // the guard is real: the files it names exist outside the closure
    for (const p of [
      'src/services/engineAlerts.ts',
      'src/services/engineAlertDelivery.ts',
      'src/services/engineAlertJournal.ts',
      'src/services/horseTelemetryGapAlert.ts',
    ]) {
      expect(alertFile.test(p), p).toBe(true);
      expect(existsSync(path.join(serverRoot, p)), p).toBe(true);
    }
  });

  it('a new runtime import enters the closure; a type-only import does not', () => {
    const files: Record<string, string> = {
      'src/a.ts':
        "import { b } from './b.js';\nimport type { T } from './t.js';\nexport const a = b;",
      'src/b.ts': "import { type U } from './u.js';\nexport const b = 1;",
      'src/t.ts': 'export type T = 1;',
      'src/u.ts': 'export type U = 1;',
      'src/c.ts': 'export const c = 1;',
      'src/d.json': '{}',
    };
    const r = (p: string) => {
      if (!(p in files)) throw Error('missing');
      return files[p];
    };
    expect(horseDecisionClosure(r, [], ['src/a.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
    files['src/b.ts'] +=
      "\nimport './c.js';\nconst d = new URL('./d.json', import.meta.url);\n// import { x } from './nope.js';";
    expect(horseDecisionClosure(r, [], ['src/a.ts'])).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.json',
    ]);
    files['src/b.ts'] += "\nexport { e } from './missing.js';";
    expect(() => horseDecisionClosure(r, [], ['src/a.ts'])).toThrow(/unresolved/);
  });
  it('declares every computed load site, and binds what each one executes', () => {
    const undeclared: Record<string, string[]> = {};
    for (const rel of closure.filter((p) => /\.(?:ts|mjs|js)$/.test(p))) {
      const sites = indirectLoadSites(rel, read(rel).toString());
      const declared = [...(HORSE_DECISION_CLOSURE_INDIRECT_LOADS[rel]?.sites ?? [])].sort();
      if (sites.join(',') !== declared.join(',')) undeclared[rel] = sites;
    }
    expect(
      undeclared,
      'a closure file loads a computed target: declare it in HORSE_DECISION_CLOSURE_INDIRECT_LOADS ' +
        '(HorseDecisionClosure.ts) with the files it loads, and make the executed ones closure entries'
    ).toEqual({});
    for (const [rel, entry] of Object.entries(HORSE_DECISION_CLOSURE_INDIRECT_LOADS)) {
      expect(closure, `declared site file ${rel}`).toContain(rel);
      // Exactly one of: the files it loads, or why its bytes are bound elsewhere.
      expect(!!entry.loads?.length !== !!entry.boundElsewhere, rel).toBe(true);
      for (const p of entry.loads ?? []) expect(closure, `${p} loaded by ${rel}`).toContain(p);
    }
    for (const [rel, why] of Object.entries(HORSE_DECISION_CLOSURE_EXTERNAL_INPUTS)) {
      expect(closure, rel).toContain(rel);
      expect(read(rel).toString(), rel).toContain(`process.env.${why.split(':')[0]}`);
    }
  });

  it('a declared site still points at what it declares, and at nothing unbound', () => {
    // Independent review, 2026-11-09: counting site kinds alone missed a
    // retargeted load (client.ts spawning a new workerV2.ts kept the kinds
    // `url, worker`, and the new worker fell outside the closure). So, for
    // every site that executes repository code: each declared executed module
    // is named by a relative literal in its site file, and every relative
    // literal there that names an existing code file is in the closure.
    const code = /\.(?:ts|js|mjs)$/;
    const unbound: string[] = [];
    for (const [rel, entry] of Object.entries(HORSE_DECISION_CLOSURE_INDIRECT_LOADS)) {
      if (!entry.loads?.length) continue;
      const sf = ts.createSourceFile(rel, read(rel).toString(), ts.ScriptTarget.Latest, true);
      const literals: string[] = [];
      const visit = (n: ts.Node) => {
        if (
          (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
          /^\.\.?\//.test(n.text)
        )
          literals.push(n.text);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      const stems = new Set(literals.map((l) => path.posix.basename(l).replace(/\.[^.]+$/, '')));
      for (const load of entry.loads.filter((l) => l.endsWith('.ts')))
        expect(stems, `${rel} no longer names ${load}`).toContain(
          path.posix.basename(load).replace(/\.ts$/, '')
        );
      for (const lit of literals.filter((l) => code.test(l))) {
        const joined = path.posix.normalize(path.posix.join(path.posix.dirname(rel), lit));
        const target = [joined, joined.replace(/\.js$/, '.ts')].find((c) =>
          existsSync(path.join(serverRoot, c))
        );
        if (target && !closure.includes(target)) unbound.push(`${rel} -> ${target}`);
      }
    }
    expect(unbound, 'a computed load site names a code file outside the closure').toEqual([]);
  });

  it('sees the computed load sites a scanner cannot follow', () => {
    const src = [
      "const entry = x ? './worker.ts' : './worker.js';",
      'new Worker(new URL(entry, import.meta.url));',
      "new Worker(new URL('./literal.js', import.meta.url));",
      "const r = createRequire(import.meta.url); r('./addon.node');",
      'await import(name);',
      "await import('./fine.js');",
      "new URL('https://example.com');",
      'new URL(SUPABASE_URL);',
    ].join('\n');
    expect(indirectLoadSites('src/x.ts', src)).toEqual(['import', 'require', 'url', 'worker']);
  });

  // Sensitivity is proven at admission itself: HorseFeatureAuthority.test.ts
  // changes each bound byte in turn and every one refuses.
});
