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
 * from the decision entry points (the reference decision, the worker runtime,
 * its client and the worker threads that client spawns, the feature admission
 * module and the qualification harness
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
 *
 * A load whose target is COMPUTED (a non-literal `new URL(x, import.meta.url)`,
 * `new Worker(x)`, `createRequire`, a non-literal `import(x)`) is invisible to
 * any scanner. Every such site in the closure is declared in
 * HORSE_DECISION_CLOSURE_INDIRECT_LOADS below, naming the files it loads (each
 * bound, the executed ones as entries so their own imports are walked) or why
 * the bytes it reads are bound elsewhere. HorseDecisionClosure.test.ts fails
 * on any undeclared site, so the decision worker thread cannot fall out of the
 * closure again the way it did when client.ts built its entry from a variable.
 */
export const HORSE_DECISION_CLOSURE_BINDING = 'horse-decision-closure-v1' as const;
export const HORSE_DECISION_CLOSURE_ENTRIES: readonly string[] = Object.freeze([
  'src/engine/HorseLogic.ts',
  'src/engine/horseDecision/workerRuntime.ts',
  'src/engine/horseDecision/client.ts',
  // Spawned by client.ts from a computed URL: the thread every production
  // decision runs on, and the journal writer thread it prespawns.
  'src/engine/horseDecision/worker.ts',
  'src/services/horseDecisionJournal/worker.ts',
  'src/engine/HorseFeatureAuthority.ts',
  'src/scripts/featureAblationQualify.ts',
]);
/**
 * Every computed load site in the closure (see the header). `sites` lists the
 * site kinds in the file, sorted, so a new site in a declared file is as
 * visible as one in an undeclared file. `loads` are server-relative files the
 * sites execute or read; every one must be in the closure. `boundElsewhere`
 * says why bytes a site reads are not decision source the closure must hold.
 */
export interface HorseDecisionIndirectLoad {
  sites: readonly ('url' | 'worker' | 'require' | 'import')[];
  loads?: readonly string[];
  boundElsewhere?: string;
}
const HASH_INPUT =
  'hash input: reads the bytes of files on its own digest list to hash them; it never executes or decides with them';
const REGISTRY =
  'qualification registry or release evidence, authenticated by protected provenance (excluded from the closure as above)';
export const HORSE_DECISION_CLOSURE_INDIRECT_LOADS: Readonly<
  Record<string, HorseDecisionIndirectLoad>
> = Object.freeze({
  'src/engine/horseDecision/client.ts': {
    sites: ['url', 'worker'],
    loads: ['src/engine/horseDecision/worker.ts'],
  },
  'src/services/HorseDecisionJournal.ts': {
    sites: ['url', 'worker'],
    loads: ['src/services/horseDecisionJournal/worker.ts'],
  },
  'src/engine/GtoPublicHist215Features.ts': {
    sites: ['require'],
    // The .node addon is compiled from exactly these two maintained files.
    loads: ['native/public_hist215_wtl.cc', 'scripts/build-public-hist215-native.mjs'],
  },
  'src/services/horseDecisionJournal/store.ts': {
    sites: ['require'],
    boundElsewhere:
      'the Node builtin node:sqlite, part of the runtime image, not a repository file',
  },
  'src/benchmark/FeatureAblationQualification.ts': { sites: ['url'], boundElsewhere: REGISTRY },
  'src/benchmark/IncrementalPressureQualification.ts': {
    sites: ['url', 'url', 'url'],
    boundElsewhere: `${REGISTRY}; and the closure hash check itself (${HASH_INPUT})`,
  },
  'src/engine/HorseQualifiedAuthority.ts': { sites: ['url', 'url'], boundElsewhere: REGISTRY },
  'src/engine/HorseFeatureAuthority.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorseCatastropheGuardPolicyDigest.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorsePhase8PolicyDigest.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorsePhase10Authority.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorsePhase11PolicyDigest.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorsePhase12PolicyDigest.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorsePhase13PolicyDigest.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/engine/HorseTournamentFlagAuthority.ts': { sites: ['url'], boundElsewhere: HASH_INPUT },
  'src/services/horseCorrectiveReview/kernelPolicyDigest.ts': {
    sites: ['url'],
    boundElsewhere: HASH_INPUT,
  },
});
/**
 * Inputs read from a path the environment names, not the source tree. They are
 * not files in this repository, so no source binding can hold them; they are
 * listed so the boundary is written down rather than implied.
 */
export const HORSE_DECISION_CLOSURE_EXTERNAL_INPUTS: Readonly<Record<string, string>> =
  Object.freeze({
    'src/gto/SolverPolicyArtifactLoader.ts':
      'SOLVER_POLICY_ARTIFACT_PATH: an optional solver chart artifact file read (and refreshed every five minutes) from the path the environment names; absent, the charts hydrate from memory_charts_gold. Data, not source: no source binding can hold it',
  });
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
