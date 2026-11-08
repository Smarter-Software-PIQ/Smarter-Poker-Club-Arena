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
      'src/engine/HorseDecisionClosure.ts',
      'src/engine/HorseFeatureLiveDomain.ts',
      'src/benchmark/IncrementalPressureQualification.ts',
      'src/benchmark/IncrementalPressureDevelopment.ts',
    ])
      expect(closure, p).toContain(p);
    expect(closure.some((p) => /\.(?:test|spec)\.ts$/.test(p))).toBe(false);
    expect(closure.some(isHorseDecisionClosureRegistry)).toBe(false);
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
  // Sensitivity is proven at admission itself: HorseFeatureAuthority.test.ts
  // changes each bound byte in turn and every one refuses.
});
