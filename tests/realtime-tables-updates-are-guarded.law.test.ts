/**
 * LAW: every hot-runtime `.from('tables').update(...)` must guard against no-op
 * writes (or be explicitly allowlisted as a one-off lifecycle / diff-guarded
 * mutation).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `public.tables` is a 150+-column table published on `supabase_realtime`.
 * Every `UPDATE public.tables` — even a no-op write that sets `current_players`
 * or `status` or `bomb_pot_sched_state` to the exact value already stored —
 * writes a full WAL row, triggers Postgres logical decoding, and fans out a
 * Realtime broadcast to every subscribed lobby and table client.
 *
 * During peak multi-table traffic, unguarded per-hand or periodic updates on
 * `public.tables` amplify WAL volume and Realtime egress by orders of magnitude.
 *
 * This source law scans every `.ts` and `.tsx` file under `server/src/` and
 * `src/` (excluding `*.test.ts*`) for `.from('tables').update(` (single or
 * double quotes) and enforces that every call site in hot runtime paths:
 *   - `server/src/engine/`
 *   - `server/src/tournament/`
 *   - `server/src/lightning/`
 *   - `server/src/services/supabase/tables.ts`
 *   - `src/services/TableService.ts`
 * MUST either:
 *   1. Include a DB-side change filter (`.or(`, `.neq(`, or `.is(`) in its
 *      chained query, OR
 *   2. Be explicitly registered 1-to-1 in `HOT_RUNTIME_ALLOWLIST` below with a
 *      documented rationale explaining why it is a one-off lifecycle write,
 *      atomic state-transition claim, or in-memory diff-guarded mutation.
 *
 * No future PR may add a new unguarded `.from('tables').update(` in the engine,
 * tournament manager, lightning runtime, or `TableService` without failing CI.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SCAN_ROOTS = ['server/src', 'src'] as const;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const SOURCE_FILE_RE = /\.tsx?$/;
const TEST_FILE_RE = /\.(?:test|spec)\.tsx?$/;

const HOT_RUNTIME_PATHS = [
  'server/src/engine/',
  'server/src/tournament/',
  'server/src/lightning/',
  'server/src/services/supabase/tables.ts',
  'src/services/TableService.ts',
] as const;

export interface AllowlistEntry {
  file: string;
  payloadSignature: string;
  auditedLine: number;
  reason: string;
}

/**
 * Finite, line-audited allowlist for hot-runtime `.from('tables').update(`
 * call sites that do not chain `.or(`, `.neq(`, or `.is(` directly on the
 * statement.
 *
 * Each entry binds 1-to-1 to a single call site (matching both `file` and
 * `payloadSignature`). Adding a second unguarded call site — even with the
 * same payload — fails CI. Removing or adding a DB-side filter to an
 * allowlisted site also fails the stale-entry check so the allowlist can only
 * shrink cleanly over time.
 */
export const HOT_RUNTIME_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: 'server/src/engine/ServerTableEngineDealing.ts',
    payloadSignature: '.update({ first_button_seat: headsUpFirstButton })',
    auditedLine: 3525,
    reason:
      'One-off lifecycle write on Hand 1 of a heads-up tournament table to persist drawn first button across restarts.',
  },
  {
    file: 'server/src/engine/ServerTableEngineDealing.ts',
    payloadSignature: '.update({ bomb_pot_manual_pending: false })',
    auditedLine: 3892,
    reason:
      "DB-side atomic state-transition claim guarded by .eq('bomb_pot_manual_pending', true); only matches armed rows.",
  },
  {
    file: 'server/src/engine/ServerTableEngineDealing.ts',
    payloadSignature:
      '.update({ bomb_pot_sched_state: snapObj, bomb_pot_next_due_at: dueAtIso })',
    auditedLine: 4066,
    reason:
      'In-memory canonicalBombPotPersistKey JSON diff guard (snap !== this.bombPotSchedPersistedJson) plus conditional DB-side .or(BOMB_POT_CLEAR_CHANGED_FILTER) on null clear.',
  },
  {
    file: 'server/src/tournament/TournamentManagerBase.ts',
    payloadSignature:
      '.update({ small_blind: smallBlind, big_blind: bigBlind, ante, stakes })',
    auditedLine: 9450,
    reason:
      'One-off startup blind recovery guarded by in-memory equality check on small_blind, big_blind, ante, and stakes.',
  },
  {
    file: 'server/src/tournament/TournamentManagerBase.ts',
    payloadSignature: '.update({ first_button_seat: null })',
    auditedLine: 11477,
    reason:
      'One-off startup cleanup in restoreDrawnFirstButtons; only runs on restart for tables with first_button_seat > 0 and settled hands.',
  },
  {
    file: 'server/src/tournament/TournamentManagerBase.ts',
    payloadSignature: '.update({ first_button_seat: seat })',
    auditedLine: 11598,
    reason:
      'One-off lifecycle write at tournament table start to persist the drawn initial button seat.',
  },
  {
    file: 'src/services/TableService.ts',
    payloadSignature: '.update(settings)',
    auditedLine: 604,
    reason:
      'Rare club admin UI action (TableService.updateSettings) updating table blinds, ante, or max_players.',
  },
];

export interface TablesUpdateSite {
  file: string;
  line: number;
  statement: string;
  hasDbChangeFilter: boolean;
  isHotRuntime: boolean;
}

export interface ScanEvaluation {
  sites: TablesUpdateSite[];
  violations: TablesUpdateSite[];
  staleAllowlist: AllowlistEntry[];
}

const TABLES_UPDATE_RE = /\.from\(\s*['"]tables['"]\s*\)\s*\.update\s*\(/g;
const DB_CHANGE_FILTER_RE = /\.(?:or|neq|is)\s*\(/;

export function isHotRuntimePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return HOT_RUNTIME_PATHS.some((prefix) =>
    prefix.endsWith('/') ? normalized.startsWith(prefix) : normalized === prefix
  );
}

/**
 * Blank out JS/TS comments while keeping string literals intact and preserving
 * exact byte offsets and line numbers.
 */
function blankCommentsPreservingStrings(src: string): string {
  return src.replace(
    /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match) => {
      if (match.startsWith('/*') || match.startsWith('//')) {
        return match.replace(/[^\n]/g, ' ');
      }
      return match;
    }
  );
}

/**
 * Blank out string literals in an already comment-blanked statement so a string
 * payload like `{ name: '.or(x)' }` cannot spoof the `.or(` / `.neq(` / `.is(`
 * method-call detector.
 */
function blankStrings(code: string): string {
  return code.replace(
    /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (match) => match.replace(/[^\n]/g, ' ')
  );
}

/**
 * Structurally extract the chained query statement starting at `startIndex`
 * (the `.from('tables').update(` match) until the enclosing statement ends:
 * either `;` at delimiter depth 0, or a closing `)` / `}` / `]` that closes an
 * outer call/block (e.g. `Promise.resolve(supabase.from('tables').update(...))`).
 */
function extractChainedStatement(commentBlanked: string, startIndex: number): string {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = startIndex; i < commentBlanked.length; i++) {
    const ch = commentBlanked[i];
    const prev = i > startIndex ? commentBlanked[i - 1] : '';

    if (inSingle) {
      if (ch === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`' && prev !== '\\') inTemplate = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') {
      if (parenDepth === 0) return commentBlanked.slice(startIndex, i);
      parenDepth--;
    } else if (ch === '{') braceDepth++;
    else if (ch === '}') {
      if (braceDepth === 0) return commentBlanked.slice(startIndex, i);
      braceDepth--;
    } else if (ch === '[') bracketDepth++;
    else if (ch === ']') {
      if (bracketDepth === 0) return commentBlanked.slice(startIndex, i);
      bracketDepth--;
    } else if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return commentBlanked.slice(startIndex, i + 1);
    }
  }

  return commentBlanked.slice(startIndex);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function scanTablesUpdatesInSource(relPath: string, rawSource: string): TablesUpdateSite[] {
  const normalizedPath = relPath.replace(/\\/g, '/');
  const commentBlanked = blankCommentsPreservingStrings(rawSource);
  const sites: TablesUpdateSite[] = [];
  const hot = isHotRuntimePath(normalizedPath);

  TABLES_UPDATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TABLES_UPDATE_RE.exec(commentBlanked)) !== null) {
    const line = commentBlanked.slice(0, match.index).split('\n').length;
    const statement = extractChainedStatement(commentBlanked, match.index);
    const hasDbChangeFilter = DB_CHANGE_FILTER_RE.test(blankStrings(statement));
    sites.push({
      file: normalizedPath,
      line,
      statement,
      hasDbChangeFilter,
      isHotRuntime: hot,
    });
  }

  return sites;
}

export function evaluateTablesUpdateSites(
  sites: readonly TablesUpdateSite[],
  allowlist: readonly AllowlistEntry[] = HOT_RUNTIME_ALLOWLIST
): ScanEvaluation {
  const usedAllowlistIndices = new Set<number>();
  const violations: TablesUpdateSite[] = [];

  for (const site of sites) {
    if (!site.isHotRuntime) continue;
    if (site.hasDbChangeFilter) continue;

    const normalizedStmt = normalizeWhitespace(site.statement);
    const matchIdx = allowlist.findIndex(
      (entry, idx) =>
        !usedAllowlistIndices.has(idx) &&
        entry.file === site.file &&
        normalizedStmt.includes(normalizeWhitespace(entry.payloadSignature))
    );

    if (matchIdx >= 0) {
      usedAllowlistIndices.add(matchIdx);
    } else {
      violations.push(site);
    }
  }

  const staleAllowlist = allowlist.filter((_, idx) => !usedAllowlistIndices.has(idx));
  return { sites: [...sites], violations, staleAllowlist };
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectSourceFiles(join(dir, entry.name), out);
      }
    } else if (SOURCE_FILE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name)) {
      out.push(relative(ROOT, join(abs, entry.name)).replace(/\\/g, '/'));
    }
  }
  return out;
}

describe('realtime public.tables no-op write guard scanner (unit tests)', () => {
  it('FAILS on a synthetic unguarded .from(\'tables\').update({ current_players: n }).eq(\'id\', id) in hot runtime', () => {
    const badSource = `
      async function syncCount(id: string, n: number) {
        await supabase.from('tables').update({ current_players: n }).eq('id', id);
      }
    `;
    const sites = scanTablesUpdatesInSource('server/src/engine/FakeEngine.ts', badSource);
    const result = evaluateTablesUpdateSites(sites, []);

    expect(sites).toHaveLength(1);
    expect(sites[0].hasDbChangeFilter).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe('server/src/engine/FakeEngine.ts');
  });

  it('FAILS on double-quoted .from("tables").update(...) and Promise.resolve-wrapped unguarded calls', () => {
    const badSource = `
      void Promise.resolve(
        supabase.from("tables").update({ status: 'running' }).eq('id', id)
      ).catch(() => {});
    `;
    const sites = scanTablesUpdatesInSource('server/src/lightning/FakePool.ts', badSource);
    const result = evaluateTablesUpdateSites(sites, []);

    expect(sites).toHaveLength(1);
    expect(result.violations).toHaveLength(1);
  });

  it('PASSES when the chained query includes a DB-side .or(...), .neq(...), or .is(...) change filter', () => {
    const goodSource = `
      await supabase
        .from('tables')
        .update({ current_players: n })
        .eq('id', id)
        .or(\`current_players.is.null,current_players.neq.\${n}\`);

      await supabase
        .from('tables')
        .update({ status: 'running' })
        .eq('id', id)
        .neq('status', 'running');

      await supabase
        .from('tables')
        .update({ first_button_seat: seat })
        .eq('id', id)
        .is('first_button_seat', null);
    `;
    const sites = scanTablesUpdatesInSource('src/services/TableService.ts', goodSource);
    const result = evaluateTablesUpdateSites(sites, []);

    expect(sites).toHaveLength(3);
    expect(sites.every((s) => s.hasDbChangeFilter)).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('ignores comments and cannot be spoofed by a string literal containing .or(', () => {
    const trickySource = `
      // supabase.from('tables').update({ current_players: 1 }).eq('id', id);
      /* supabase.from("tables").update({ status: 'waiting' }).eq('id', id); */
      await supabase.from('tables').update({ name: '.or(not_a_real_filter)' }).eq('id', id);
    `;
    const sites = scanTablesUpdatesInSource('server/src/tournament/FakeTourney.ts', trickySource);
    const result = evaluateTablesUpdateSites(sites, []);

    expect(sites).toHaveLength(1);
    expect(sites[0].hasDbChangeFilter).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('enforces strict 1-to-1 allowlist binding (duplicate unguarded site fails; stale allowlist fails)', () => {
    const duplicatedSource = `
      await supabase.from('tables').update(settings).eq('id', tableId);
      await supabase.from('tables').update(settings).eq('id', otherId);
    `;
    const allowlist: AllowlistEntry[] = [
      {
        file: 'src/services/TableService.ts',
        payloadSignature: '.update(settings)',
        auditedLine: 1,
        reason: 'Test single-site allowlist entry.',
      },
      {
        file: 'src/services/TableService.ts',
        payloadSignature: '.update({ nonexistent: true })',
        auditedLine: 99,
        reason: 'Stale entry that should be flagged.',
      },
    ];
    const sites = scanTablesUpdatesInSource('src/services/TableService.ts', duplicatedSource);
    const result = evaluateTablesUpdateSites(sites, allowlist);

    expect(result.violations).toHaveLength(1);
    expect(result.staleAllowlist).toHaveLength(1);
    expect(result.staleAllowlist[0].payloadSignature).toBe('.update({ nonexistent: true })');
  });
});

describe('LAW: every hot-runtime public.tables update is guarded against no-op Realtime fan-out', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
  const allSites = sourceFiles.flatMap((rel) =>
    scanTablesUpdatesInSource(rel, readFileSync(join(ROOT, rel), 'utf8'))
  );
  const evaluation = evaluateTablesUpdateSites(allSites, HOT_RUNTIME_ALLOWLIST);

  it('scans server/src/ and src/ and discovers the live public.tables update call sites', () => {
    const hotSites = allSites.filter((s) => s.isHotRuntime);
    const dbGuardedHotSites = hotSites.filter((s) => s.hasDbChangeFilter);

    // Sanity guards so a broken regex or wrong root cannot pass vacuously.
    expect(allSites.length).toBeGreaterThanOrEqual(10);
    expect(hotSites.length).toBeGreaterThanOrEqual(HOT_RUNTIME_ALLOWLIST.length + 3);
    expect(dbGuardedHotSites.length).toBeGreaterThanOrEqual(3);
  });

  it('has ZERO unguarded, un-allowlisted .from(\'tables\').update(...) call sites in hot runtime paths', () => {
    const formattedViolations = evaluation.violations.map(
      (v) => `${v.file}:${v.line}  ${normalizeWhitespace(v.statement)}`
    );

    expect(
      formattedViolations,
      'Unguarded public.tables UPDATE in a hot runtime path causes no-op WAL + Supabase Realtime fan-out.\n' +
        'Add a DB-side change filter (.or(...), .neq(...), or .is(...)) such as tableCountChangedFilter(...),\n' +
        'OR — only if this is a verified one-off lifecycle write or in-memory diff-guarded mutation —\n' +
        'register it in HOT_RUNTIME_ALLOWLIST in tests/realtime-tables-updates-are-guarded.law.test.ts:\n' +
        formattedViolations.join('\n')
    ).toEqual([]);
  });

  it('has ZERO stale entries in HOT_RUNTIME_ALLOWLIST', () => {
    const formattedStale = evaluation.staleAllowlist.map(
      (e) => `${e.file}:${e.auditedLine}  ${e.payloadSignature}`
    );

    expect(
      formattedStale,
      'Stale HOT_RUNTIME_ALLOWLIST entries no longer match an unguarded call site (deleted or now DB-guarded).\n' +
        'Remove them from HOT_RUNTIME_ALLOWLIST so the allowlist stays finite and exact:\n' +
        formattedStale.join('\n')
    ).toEqual([]);
  });
});
