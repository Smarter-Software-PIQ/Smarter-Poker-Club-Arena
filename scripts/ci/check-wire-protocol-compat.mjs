#!/usr/bin/env node
/**
 * Client-Engine Wire-Protocol Compatibility Guard.
 *
 * Scans WebSocket message/event type unions and RPC names shared between
 * `server/src/` and `src/` against a base ref (`origin/main` or `--base`)
 * and flags breaking removals or renames of existing identifiers that live
 * cached clients still emit or consume. Additive changes pass cleanly.
 *
 * Exit codes (CLAUDE.md 10.86 fail-safe):
 *   0  Compatible (no breaking removals or renames)
 *   1  Breaking wire-protocol removal or rename detected
 *   3  Base ref unreadable or git inspection error
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT_OK = 0;
export const EXIT_BREAKING = 1;
export const EXIT_UNREADABLE = 3;

const TEST_FILE_RE = /\.(test|spec|law\.test)\.[cm]?[jt]sx?$/;
const CODE_FILE_RE = /\.[cm]?[jt]sx?$/;

/** Directories and files defining or consuming the WebSocket wire protocol. */
export function isWsProtocolPath(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (TEST_FILE_RE.test(p) || !CODE_FILE_RE.test(p)) return false;
  if (p.startsWith('server/src/transport/') || p.startsWith('server/src/hub/')) return true;
  if (
    p === 'src/services/EngineStateClient.ts' ||
    p === 'src/services/EngineSocketMux.ts' ||
    p === 'src/services/TableWebSocket.ts' ||
    p === 'src/services/RealtimeChannelService.ts'
  ) {
    return true;
  }
  return false;
}

/** Files eligible for RPC name scanning. */
export function isRpcScanPath(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (TEST_FILE_RE.test(p) || !CODE_FILE_RE.test(p)) return false;
  return p.startsWith('server/src/') || p.startsWith('src/');
}

/** Strip line and block comments while preserving string literals so comments never produce false matches. */
export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    // String or template literal
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < n) {
        const c = source[i];
        out += c;
        if (c === '\\' && i + 1 < n) {
          i += 1;
          out += source[i];
          i += 1;
          continue;
        }
        i += 1;
        if (c === quote) break;
      }
      continue;
    }
    // Single-line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Extract WebSocket frame/event type union identifiers from a TypeScript source file.
 * Captures UPPER_SNAKE_CASE frame discriminants (`type: 'SNAPSHOT'`, `case 'PING':`,
 * `msg.type === 'RESYNC'`, etc.) and explicit `type: '...'` event discriminants.
 */
export function extractWsMessageTypes(source) {
  const cleaned = stripComments(source);
  const found = new Set();

  const patterns = [
    /\btype\s*:\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
    /\bcase\s+['"]([A-Z][A-Z0-9_]{2,})['"]\s*:/g,
    /\.type\s*===?\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
    /['"]([A-Z][A-Z0-9_]{2,})['"]\s*===?\s*[a-zA-Z_$][\w$.]*\.type\b/g,
  ];
  for (const re of patterns) {
    for (const m of cleaned.matchAll(re)) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

/**
 * Extract RPC names invoked via `.rpc('...')` or declared in engine RPC maps.
 */
export function extractRpcNames(source) {
  const cleaned = stripComments(source);
  const found = new Set();
  const rpcCallRe = /\.rpc\(\s*['"]([a-zA-Z][a-zA-Z0-9_]{2,})['"]/g;
  for (const m of cleaned.matchAll(rpcCallRe)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * Build a deterministic wire-protocol contract map from an array of `{ path, content }` files.
 */
export function buildContractFromSources(files) {
  const serverWs = new Map(); // id -> Set<path>
  const clientWs = new Map();
  const serverRpc = new Map();
  const clientRpc = new Map();

  const add = (map, id, path) => {
    let set = map.get(id);
    if (!set) {
      set = new Set();
      map.set(id, set);
    }
    set.add(path);
  };

  for (const file of files) {
    const relPath = file.path.replace(/\\/g, '/');
    const isServer = relPath.startsWith('server/src/');
    const isClient = relPath.startsWith('src/');
    if (!isServer && !isClient) continue;

    if (isWsProtocolPath(relPath)) {
      const wsTypes = extractWsMessageTypes(file.content);
      const targetMap = isServer ? serverWs : clientWs;
      for (const id of wsTypes) add(targetMap, id, relPath);
    }

    if (isRpcScanPath(relPath)) {
      const rpcs = extractRpcNames(file.content);
      const targetMap = isServer ? serverRpc : clientRpc;
      for (const id of rpcs) add(targetMap, id, relPath);
    }
  }

  const toObj = (map) => {
    const obj = {};
    for (const key of [...map.keys()].sort()) {
      obj[key] = [...map.get(key)].sort();
    }
    return obj;
  };

  const serverWsObj = toObj(serverWs);
  const clientWsObj = toObj(clientWs);
  const serverRpcObj = toObj(serverRpc);
  const clientRpcObj = toObj(clientRpc);

  const sharedWs = Object.keys(serverWsObj)
    .filter((k) => Object.prototype.hasOwnProperty.call(clientWsObj, k))
    .sort();
  const sharedRpc = Object.keys(serverRpcObj)
    .filter((k) => Object.prototype.hasOwnProperty.call(clientRpcObj, k))
    .sort();

  return {
    server: { wsTypes: serverWsObj, rpcNames: serverRpcObj },
    client: { wsTypes: clientWsObj, rpcNames: clientRpcObj },
    shared: { wsTypes: sharedWs, rpcNames: sharedRpc },
  };
}

function tokenSimilarity(a, b) {
  const tokA = new Set(a.toLowerCase().split('_').filter(Boolean));
  const tokB = new Set(b.toLowerCase().split('_').filter(Boolean));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let shared = 0;
  for (const t of tokA) {
    if (tokB.has(t)) shared += 1;
  }
  const jaccard = shared / (tokA.size + tokB.size - shared);
  const prefixBonus = a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()) ? 0.35 : 0;
  return Math.min(1, jaccard + prefixBonus);
}

function detectSuspectedRename(removedId, addedIds) {
  let best = null;
  let bestScore = 0;
  for (const candidate of addedIds) {
    const score = tokenSimilarity(removedId, candidate);
    if (score > bestScore && score >= 0.4) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

const MIGRATION_SQL_RE = /\.sql$/;
const SUPERSEDED_SQL_RE = /^--[ \t]*SUPERSEDED\s+BY\s+\d{14}\b/im;
const PG_QUALIFIED_NAME_RE = String.raw`((?:"?[A-Za-z_][A-Za-z0-9_$]*"?\s*\.\s*)?"?[A-Za-z_][A-Za-z0-9_$]*"?)`;
const PG_IDENT_RE = String.raw`("?[A-Za-z_][A-Za-z0-9_$]*"?)`;

function unquotePgIdent(raw) {
  return String(raw || '').replace(/"/g, '').trim().toLowerCase();
}

function splitPgSchemaName(raw) {
  const clean = unquotePgIdent(raw).replace(/\s*\.\s*/, '.');
  const dot = clean.indexOf('.');
  if (dot < 0) return { schema: 'public', name: clean };
  return { schema: clean.slice(0, dot), name: clean.slice(dot + 1) };
}

function stripSqlCommentsAndBodies(sql) {
  const s = String(sql);
  let out = '';
  let i = 0;
  let stmtStart = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '-' && n === '-') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? s.length : e;
      continue;
    }
    if (c === '/' && n === '*') {
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? s.length : e + 2;
      out += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) {
        const k = s.indexOf("'", j);
        if (k < 0) {
          j = s.length;
          break;
        }
        if (s[k + 1] === "'") {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      out += "''";
      i = j;
      continue;
    }
    if (c === '$' && !/[A-Za-z0-9_$]/.test(s[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        const body = s.slice(i + tag.length, close < 0 ? s.length : close);
        const stmtHeader = out.slice(stmtStart).trim();
        if (/^DO\b/i.test(stmtHeader)) {
          out = out.slice(0, stmtStart) + ' ' + stripSqlCommentsAndBodies(body) + ';';
          stmtStart = out.length;
        } else {
          out += "''";
        }
        i = close < 0 ? s.length : close + tag.length;
        continue;
      }
    }
    if (c === ';') stmtStart = out.length + 1;
    out += c;
    i++;
  }
  return out;
}

function balancedParenEnd(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

function countParamArity(paramListText) {
  const trimmed = String(paramListText || '').trim();
  if (!trimmed) return 0;
  let count = 1;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

/**
 * Scan chronological `supabase/migrations/*.sql` files and return the Set of
 * lowercase Postgres function names that are currently defined (CREATE [OR REPLACE]
 * FUNCTION) and NOT completely dropped (DROP FUNCTION) at HEAD. Tracks overload
 * arity so dropping an older overload while a newer overload remains does not
 * falsely mark the RPC as dropped.
 */
export function scanPostgresRpcDefinitions(migrationFiles) {
  const activeOverloads = new Map(); // name -> Set<number>
  const addOverload = (name, arity) => {
    let set = activeOverloads.get(name);
    if (!set) {
      set = new Set();
      activeOverloads.set(name, set);
    }
    set.add(arity);
  };
  const dropOverload = (name, arity) => {
    if (arity === null) {
      activeOverloads.delete(name);
      return;
    }
    const set = activeOverloads.get(name);
    if (!set) return;
    set.delete(arity);
    if (set.size === 0) activeOverloads.delete(name);
  };

  const sorted = [...(migrationFiles ?? [])].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );

  for (const file of sorted) {
    if (!file || typeof file.content !== 'string') continue;
    if (SUPERSEDED_SQL_RE.test(file.content)) continue;
    const cleaned = stripSqlCommentsAndBodies(file.content);
    for (const rawStmt of cleaned.split(';')) {
      let stmt = rawStmt.trim();
      for (;;) {
        const next = stmt
          .replace(/^DECLARE\b[^;]*;\s*/i, '')
          .replace(/^(?:BEGIN|ELSE|LOOP|EXCEPTION)\b\s*/i, '')
          .replace(/^(?:IF|ELSIF|WHEN)\b[\s\S]*?\bTHEN\b\s*/i, '')
          .replace(/^FOR\b[\s\S]*?\bLOOP\b\s*/i, '')
          .trim();
        if (next === stmt) break;
        stmt = next;
      }
      if (!stmt) continue;

      const createFn = new RegExp(
        `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${PG_QUALIFIED_NAME_RE}\\s*\\(`,
        'i'
      ).exec(stmt);
      if (createFn) {
        const { schema, name } = splitPgSchemaName(createFn[1]);
        const openIdx = createFn[0].length - 1;
        const closeIdx = balancedParenEnd(stmt, openIdx);
        const arity = countParamArity(stmt.slice(openIdx + 1, closeIdx - 1));
        if (schema !== 'pg_temp' && name) addOverload(name, arity);
        continue;
      }

      const dropFn = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?/i.exec(stmt);
      if (dropFn) {
        let pos = dropFn[0].length;
        while (pos < stmt.length) {
          const nm = new RegExp(`^\\s*${PG_QUALIFIED_NAME_RE}\\s*(\\()?`).exec(stmt.slice(pos));
          if (!nm) break;
          pos += nm[0].length;
          let arity = null;
          if (nm[2]) {
            const openIdx = pos - 1;
            const closeIdx = balancedParenEnd(stmt, openIdx);
            arity = countParamArity(stmt.slice(openIdx + 1, closeIdx - 1));
            pos = closeIdx;
          }
          const { schema, name } = splitPgSchemaName(nm[1]);
          if (schema !== 'pg_temp' && name) dropOverload(name, arity);
          const comma = /^\s*,/.exec(stmt.slice(pos));
          if (!comma) break;
          pos += comma[0].length;
        }
        continue;
      }

      const renameFn = new RegExp(
        `^ALTER\\s+FUNCTION\\s+${PG_QUALIFIED_NAME_RE}\\s*(\\([\\s\\S]*?\\))?\\s+RENAME\\s+TO\\s+${PG_IDENT_RE}`,
        'i'
      ).exec(stmt);
      if (renameFn) {
        const { schema, name } = splitPgSchemaName(renameFn[1]);
        const newName = unquotePgIdent(renameFn[3]);
        const arity = renameFn[2] ? countParamArity(renameFn[2].slice(1, -1)) : null;
        if (schema !== 'pg_temp') {
          if (name) dropOverload(name, arity);
          if (newName) addOverload(newName, arity ?? 0);
        }
      }
    }
  }
  return new Set(activeOverloads.keys());
}

/**
 * Compare a base wire contract against a head wire contract.
 * Flags breaking removals/renames of identifiers that live cached clients still emit or consume.
 *
 * When `activePostgresRpcs` (a Set/Iterable of lowercase active Postgres function
 * names from `supabase/migrations/` at HEAD) is supplied, retiring an outbound
 * `server/src/` `supabase.rpc()` call whose Postgres function remains defined
 * and not dropped in `supabase/migrations/` is reported as a non-breaking
 * advisory (cached clients call Supabase PostgREST directly, and actual SQL
 * `DROP FUNCTION` is guarded by `check-migration-n-minus-1-compat.mjs`).
 */
export function compareWireContracts(base, head, { activePostgresRpcs = null } = {}) {
  const breakingChanges = [];
  const advisories = [];
  const activeRpcSet =
    activePostgresRpcs !== null && activePostgresRpcs !== undefined
      ? new Set([...activePostgresRpcs].map((s) => String(s).toLowerCase()))
      : null;
  const added = {
    serverWsTypes: [],
    clientWsTypes: [],
    serverRpcNames: [],
    clientRpcNames: [],
  };

  const baseServerWs = new Set(Object.keys(base.server.wsTypes));
  const headServerWs = new Set(Object.keys(head.server.wsTypes));
  const baseClientWs = new Set(Object.keys(base.client.wsTypes));
  const headClientWs = new Set(Object.keys(head.client.wsTypes));

  const baseServerRpc = new Set(Object.keys(base.server.rpcNames));
  const headServerRpc = new Set(Object.keys(head.server.rpcNames));
  const baseClientRpc = new Set(Object.keys(base.client.rpcNames));
  const headClientRpc = new Set(Object.keys(head.client.rpcNames));

  for (const id of headServerWs) if (!baseServerWs.has(id)) added.serverWsTypes.push(id);
  for (const id of headClientWs) if (!baseClientWs.has(id)) added.clientWsTypes.push(id);
  for (const id of headServerRpc) if (!baseServerRpc.has(id)) added.serverRpcNames.push(id);
  for (const id of headClientRpc) if (!baseClientRpc.has(id)) added.clientRpcNames.push(id);

  added.serverWsTypes.sort();
  added.clientWsTypes.sort();
  added.serverRpcNames.sort();
  added.clientRpcNames.sort();

  // 1. Server removed a WS message/event type that cached clients (base.client) still emit or consume.
  for (const id of [...baseServerWs].sort()) {
    if (!headServerWs.has(id) && baseClientWs.has(id)) {
      const suspectedRename = detectSuspectedRename(id, added.serverWsTypes);
      breakingChanges.push({
        kind: 'ws_message_type',
        side: 'server',
        identifier: id,
        reason: suspectedRename
          ? `server removed WS type "${id}" still used by live cached clients (suspected rename to "${suspectedRename}")`
          : `server removed WS type "${id}" still used by live cached clients`,
        suspectedRename,
        baseServerFiles: base.server.wsTypes[id],
        baseClientFiles: base.client.wsTypes[id],
      });
    }
  }

  // 2. Client removed handling for a WS message/event type that the live serving engine (base.server) still emits.
  for (const id of [...baseClientWs].sort()) {
    if (!headClientWs.has(id) && baseServerWs.has(id)) {
      const suspectedRename = detectSuspectedRename(id, added.clientWsTypes);
      breakingChanges.push({
        kind: 'ws_message_type',
        side: 'client',
        identifier: id,
        reason: suspectedRename
          ? `client removed WS type "${id}" still emitted/expected by live engine (suspected rename to "${suspectedRename}")`
          : `client removed WS type "${id}" still emitted/expected by live engine`,
        suspectedRename,
        baseServerFiles: base.server.wsTypes[id],
        baseClientFiles: base.client.wsTypes[id],
      });
    }
  }

  // 3. Server removed a shared RPC identifier that live cached clients still call.
  for (const id of [...baseServerRpc].sort()) {
    if (!headServerRpc.has(id) && baseClientRpc.has(id)) {
      const suspectedRename = detectSuspectedRename(id, added.serverRpcNames);
      if (activeRpcSet && activeRpcSet.has(id.toLowerCase())) {
        advisories.push({
          kind: 'rpc_name',
          side: 'server',
          identifier: id,
          reason: suspectedRename
            ? `server stopped calling Postgres RPC "${id}" (suspected rename to "${suspectedRename}"), but function remains defined in supabase/migrations/ so cached clients calling PostgREST directly are unaffected`
            : `server stopped calling Postgres RPC "${id}", but function remains defined in supabase/migrations/ so cached clients calling PostgREST directly are unaffected`,
          suspectedRename,
          baseServerFiles: base.server.rpcNames[id],
          baseClientFiles: base.client.rpcNames[id],
        });
      } else {
        breakingChanges.push({
          kind: 'rpc_name',
          side: 'server',
          identifier: id,
          reason: suspectedRename
            ? `server removed shared RPC "${id}" still referenced by live cached clients (suspected rename to "${suspectedRename}")`
            : `server removed shared RPC "${id}" still referenced by live cached clients`,
          suspectedRename,
          baseServerFiles: base.server.rpcNames[id],
          baseClientFiles: base.client.rpcNames[id],
        });
      }
    }
  }

  const ok = breakingChanges.length === 0;
  return {
    schemaVersion: 1,
    ok,
    exitCode: ok ? EXIT_OK : EXIT_BREAKING,
    summary: {
      baseSharedWsTypes: base.shared.wsTypes.length,
      headSharedWsTypes: head.shared.wsTypes.length,
      baseSharedRpcNames: base.shared.rpcNames.length,
      headSharedRpcNames: head.shared.rpcNames.length,
      breakingCount: breakingChanges.length,
      advisoryCount: advisories.length,
    },
    breakingChanges,
    advisories,
    added,
  };
}

function gitExec(repoRoot, args, input) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function readGitBlobsBatch(repoRoot, ref, relPaths) {
  if (relPaths.length === 0) return [];
  const stdin = relPaths.map((p) => `${ref}:${p}`).join('\n') + '\n';
  const raw = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch'], {
    cwd: repoRoot,
    input: stdin,
    maxBuffer: 128 * 1024 * 1024,
  });
  const files = [];
  let offset = 0;
  for (const relPath of relPaths) {
    const nl = raw.indexOf(0x0a, offset);
    if (nl === -1) break;
    const header = raw.subarray(offset, nl).toString('utf8');
    offset = nl + 1;
    if (header.endsWith(' missing')) continue;
    const parts = header.split(' ');
    const size = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(size) || size < 0) continue;
    const content = raw.subarray(offset, offset + size).toString('utf8');
    offset += size + 1; // trailing LF after blob
    files.push({ path: relPath, content });
  }
  return files;
}

/** Scan all eligible protocol/RPC files at a git ref (e.g. origin/main). */
export function scanGitRef(repoRoot, ref) {
  gitExec(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const listOut = gitExec(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', 'server/src', 'src']);
  const wsPaths = listOut
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p && isWsProtocolPath(p));

  let rpcPaths = [];
  try {
    const grepOut = gitExec(repoRoot, ['grep', '-l', '-F', '.rpc(', ref, '--', 'server/src', 'src']);
    const prefix = `${ref}:`;
    rpcPaths = grepOut
      .split('\n')
      .map((s) => s.trim())
      .map((s) => (s.startsWith(prefix) ? s.slice(prefix.length) : s))
      .filter((p) => p && isRpcScanPath(p));
  } catch (err) {
    // git grep exits 1 when there are zero matches (valid empty RPC set).
    if (!(err && typeof err === 'object' && 'status' in err && err.status === 1)) {
      throw err;
    }
  }

  const uniquePaths = [...new Set([...wsPaths, ...rpcPaths])].sort();
  const files = readGitBlobsBatch(repoRoot, ref, uniquePaths);
  return buildContractFromSources(files);
}

function walkDir(rootDir, relPrefix, out) {
  const full = join(rootDir, relPrefix);
  if (!existsSync(full)) return;
  for (const entry of readdirSync(full)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const rel = relPrefix ? posix.join(relPrefix, entry) : entry;
    const abs = join(rootDir, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkDir(rootDir, rel, out);
    } else if (st.isFile() && (isWsProtocolPath(rel) || isRpcScanPath(rel))) {
      out.push(rel);
    }
  }
}

/** Scan all eligible protocol/RPC files in the current working tree. */
export function scanWorkingTree(repoRoot) {
  const relPaths = [];
  walkDir(repoRoot, 'server/src', relPaths);
  walkDir(repoRoot, 'src', relPaths);
  relPaths.sort();
  const files = relPaths.map((relPath) => ({
    path: relPath,
    content: readFileSync(join(repoRoot, relPath), 'utf8'),
  }));
  return buildContractFromSources(files);
}

/** Scan `supabase/migrations/*.sql` at a git ref to determine active Postgres RPC definitions. */
export function scanMigrationsGitRef(repoRoot, ref) {
  const listOut = gitExec(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', 'supabase/migrations']);
  const migPaths = listOut
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p && MIGRATION_SQL_RE.test(p))
    .sort();
  const files = readGitBlobsBatch(repoRoot, ref, migPaths);
  return scanPostgresRpcDefinitions(files);
}

/** Scan `supabase/migrations/*.sql` in the working tree to determine active Postgres RPC definitions. */
export function scanMigrationsWorkingTree(repoRoot) {
  const migDir = join(repoRoot, 'supabase/migrations');
  if (!existsSync(migDir)) return new Set();
  const entries = readdirSync(migDir)
    .filter((name) => MIGRATION_SQL_RE.test(name))
    .sort();
  const files = entries.map((name) => ({
    path: `supabase/migrations/${name}`,
    content: readFileSync(join(migDir, name), 'utf8'),
  }));
  return scanPostgresRpcDefinitions(files);
}

export function runCheck({ repoRoot = process.cwd(), baseRef = 'origin/main', headRef = '' } = {}) {
  const absRoot = resolve(repoRoot);
  try {
    const base = scanGitRef(absRoot, baseRef);
    const head = headRef ? scanGitRef(absRoot, headRef) : scanWorkingTree(absRoot);
    const hasRetiredSharedServerRpc = Object.keys(base.server.rpcNames).some(
      (id) =>
        !Object.prototype.hasOwnProperty.call(head.server.rpcNames, id) &&
        Object.prototype.hasOwnProperty.call(base.client.rpcNames, id)
    );
    const activePostgresRpcs = hasRetiredSharedServerRpc
      ? headRef
        ? scanMigrationsGitRef(absRoot, headRef)
        : scanMigrationsWorkingTree(absRoot)
      : null;
    const report = compareWireContracts(base, head, { activePostgresRpcs });
    return {
      ...report,
      baseRef,
      headRef: headRef || 'working-tree',
    };
  } catch (err) {
    return {
      schemaVersion: 1,
      ok: false,
      exitCode: EXIT_UNREADABLE,
      baseRef,
      headRef: headRef || 'working-tree',
      error: err instanceof Error ? err.message : String(err),
      breakingChanges: [],
    };
  }
}

function parseCliArgs(argv) {
  const opts = { repoRoot: process.cwd(), baseRef: 'origin/main', headRef: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base' && i + 1 < argv.length) {
      opts.baseRef = argv[++i];
    } else if (arg === '--head' && i + 1 < argv.length) {
      opts.headRef = argv[++i];
    } else if (arg === '--repo-root' && i + 1 < argv.length) {
      opts.repoRoot = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.error(
        'Usage: check-wire-protocol-compat.mjs [--base <ref>] [--head <ref>] [--repo-root <dir>]'
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    const opts = parseCliArgs(process.argv.slice(2));
    const report = runCheck(opts);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.exitCode);
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          ok: false,
          exitCode: EXIT_UNREADABLE,
          error: err instanceof Error ? err.message : String(err),
        },
        null,
        2
      )
    );
    process.exit(EXIT_UNREADABLE);
  }
}
