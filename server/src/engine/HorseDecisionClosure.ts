/**
 * THE DECISION CLOSURE (2026-11-08). The exact source a feature selection is
 * measured and admitted on, computed from the code rather than declared.
 *
 * A held-out feature qualification used to bind every non-test .ts/.json under
 * server/src (1,052 files). That bound far more than a decision executes, so
 * any unrelated change anywhere in the server spent the qualification, and it
 * still missed executed modules that are not .ts/.json (a decision-path .mjs).
 * A plan that declares `sourceBinding: 'horse-decision-closure-v1'` instead
 * binds exactly this closure: every module reachable through runtime imports
 * from the decision entry points (the reference decision, the worker runtime
 * and its client, the feature admission module and the qualification harness
 * that produced the result), plus the acceptance-path files admission names
 * one by one. The qualification provider and runtime admission both recompute
 * it from the bytes in front of them and require the plan to equal it exactly,
 * so a new import, a moved helper or a changed byte refuses instead of being
 * silently outside the binding. HorseDecisionClosure.test.ts holds this walker
 * equal to the TypeScript compiler's own reading of the same import graph.
 *
 * Edges: static imports and re-exports that are not type-only, side-effect
 * imports, literal dynamic import(), and `new URL('<literal>', import.meta.url)`
 * data reads. Package imports are bound by the dependency lock, not here. An
 * unresolved relative specifier throws (fail closed). The qualification
 * registries are excluded exactly as before: a plan cannot hash itself, and
 * their bytes are authenticated by protected provenance instead.
 */
export const HORSE_DECISION_CLOSURE_BINDING = 'horse-decision-closure-v1' as const;
export const HORSE_DECISION_CLOSURE_ENTRIES: readonly string[] = Object.freeze([
  'src/engine/HorseLogic.ts',
  'src/engine/horseDecision/workerRuntime.ts',
  'src/engine/horseDecision/client.ts',
  'src/engine/HorseFeatureAuthority.ts',
  'src/scripts/featureAblationQualify.ts',
]);
/** Read by protected provenance, never self-bound (same rule as the whole-tree binding). */
export const isHorseDecisionClosureRegistry = (rel: string) =>
  /Qualification(?:Plans|Families)\.json$/.test(rel);

/** Blank out comments, leaving string and template contents intact. */
const LEXEMES =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/g;
function stripComments(src: string): string {
  return src.replace(LEXEMES, (m) => (m[0] === '/' ? m.replace(/[^\n]/g, ' ') : m));
}

/** Relative specifiers this module executes or reads at runtime. */
export function horseDecisionRuntimeSpecifiers(source: string): string[] {
  const src = stripComments(source),
    out: string[] = [];
  for (const m of src.matchAll(
    /(?:^|[;\n}])\s*import\s+(type\s+)?([\w$*{}\s,]*?)\s*from\s*(['"])([^'"]+)\3/g
  )) {
    if (m[1]) continue;
    const clause = m[2].trim(),
      named = /^\{([\s\S]*)\}$/.exec(clause);
    if (named) {
      const els = named[1]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (els.length && els.every((e) => /^type\s/.test(e))) continue;
    }
    out.push(m[4]);
  }
  for (const m of src.matchAll(/(?:^|[;\n}])\s*import\s*(['"])([^'"]+)\1/g)) out.push(m[2]);
  for (const m of src.matchAll(
    /(?:^|[;\n}])\s*export\s+(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\2/g
  ))
    if (!m[1]) out.push(m[3]);
  for (const m of src.matchAll(/(\btypeof\s+)?\bimport\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    // A type query (typeof import('x'), import('x').T) is erased, never executed;
    // a dynamic import is awaited, chained with .then( or passed as a value.
    const after = src.slice(m.index! + m[0].length);
    if (m[1] || /^\.[\w$]+(?:\.[\w$]+)*(?![\w$.]|\s*\()/.test(after)) continue;
    out.push(m[3]);
  }
  for (const m of src.matchAll(/\bnew\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g))
    out.push(m[2]);
  // A directory URL (new URL('../../', import.meta.url)) is a root, not a read.
  return out.filter((s) => s.startsWith('.') && !s.endsWith('/'));
}

const join = (fromRel: string, spec: string) => {
  const parts = fromRel.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
};

/**
 * Server-relative (src/...) paths, sorted. `read` returns a file's bytes and
 * throws when it does not exist. `singles` are bound as files without walking
 * their imports (the acceptance-path callers admission names one by one).
 */
export function horseDecisionClosure(
  read: (rel: string) => Buffer | string,
  singles: readonly string[] = [],
  entries: readonly string[] = HORSE_DECISION_CLOSURE_ENTRIES
): string[] {
  const exists = (rel: string) => {
    try {
      read(rel);
      return true;
    } catch {
      return false;
    }
  };
  const resolveSpec = (fromRel: string, spec: string): string => {
    const target = join(fromRel, spec);
    if (!target.startsWith('src/') || target.includes('..'))
      throw Error(`decision closure leaves src: ${spec} from ${fromRel}`);
    if (exists(target)) return target;
    if (target.endsWith('.js') && exists(target.slice(0, -3) + '.ts'))
      return target.slice(0, -3) + '.ts';
    throw Error(`decision closure unresolved: ${spec} from ${fromRel}`);
  };
  const seen = new Set<string>(),
    queue = [...entries];
  while (queue.length) {
    const rel = queue.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.(?:ts|mjs|js)$/.test(rel)) continue;
    for (const spec of horseDecisionRuntimeSpecifiers(read(rel).toString()))
      queue.push(resolveSpec(rel, spec));
  }
  for (const rel of singles) {
    if (!exists(rel)) throw Error(`decision closure single missing: ${rel}`);
    seen.add(rel);
  }
  return [...seen].filter((p) => !isHorseDecisionClosureRegistry(p)).sort();
}
