/** Finite PUBLIC-only matrix builder. No solver/source labels, model, DB, native
 * calls, training, retries or activation. Actual index SHA must be approved
 * before fresh licensed capture. Context matrices are materialized one at a time. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compilePublic215Template,
  encodePublic215Base181,
  encodePublic215State28,
  public215ContractVector,
  type CompiledPublic215Template,
} from '../engine/GtoPublicHist215Features.js';
import {
  isPublic215FeatureCount,
  public215FeatureContractBySchema,
} from '../engine/GtoPublicHist215Contracts.js';
import {
  canonicalPublic215Json,
  public215Digest,
  strictObject,
  validPublic215Digest,
} from '../engine/GtoPublicHist215Model.js';

type ObjectValue = Record<string, any>;
const RANKS = '23456789TJQKA',
  SUITS = 'cdhs';
const DECK = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
const COMBOS = Array.from({ length: 52 }, (_, hi) =>
  Array.from({ length: hi }, (_, lo) => [DECK[lo], DECK[hi]])
).flat();
const need = (ok: unknown, why: string): void => {
  if (!ok) throw Error('PUBLIC215_BATCH_' + why);
};
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const object = (v: unknown, keys: string[]): ObjectValue => strictObject(v, keys);
function pinned(path: string, digest: string): Buffer {
  need(
    typeof path === 'string' &&
      isAbsolute(path) &&
      realpathSync(path) === resolve(path) &&
      !path.split('/').some((x) => x.startsWith('.env')),
    'CANONICAL_PUBLIC_FILE'
  );
  need(validPublic215Digest(digest), 'FILE_SHA');
  const bytes = readFileSync(path);
  need(sha(bytes) === digest, 'PINNED_BYTES');
  return bytes;
}
function jsonFile(f: ObjectValue): ObjectValue {
  object(f, ['path', 'sha256']);
  return JSON.parse(pinned(f.path, f.sha256).toString('utf8'));
}
export const validPublic215SourceNode = (value: unknown): boolean =>
  typeof value === 'string' && /^r:0(?::(?:c|f|b[0-9]+|[2-9TJQKA][cdhs]))*$/.test(value);
function cards(board: string): string[] {
  need(typeof board === 'string' && /^(?:[2-9TJQKA][cdhs]){3,5}$/.test(board), 'BOARD');
  const out = board.match(/../g)!;
  need(new Set(out).size === out.length, 'BOARD_DUPLICATE');
  return out;
}
/** Exact decimal range grid, independent of JS float multiplication. */
export function public215RangeUnits(raw: string): bigint[] {
  raw = raw.trim();
  const tokens = raw.startsWith('[') ? raw.slice(1, -1).split(',') : raw.split(/\s+/);
  if (raw.startsWith('[')) need(raw.endsWith(']'), 'RANGE_ARRAY');
  const out = tokens.map((token) => {
    const m = /^\s*(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?\s*$/.exec(token);
    need(m, 'RANGE_DECIMAL');
    const fraction = m![2] ?? '',
      exponent = Number(m![3] ?? '0');
    need(Number.isSafeInteger(exponent) && Math.abs(exponent) <= 400, 'RANGE_EXPONENT');
    const scale = 12 + exponent - fraction.length;
    let value = BigInt(m![1] + fraction);
    if (scale >= 0) value *= 10n ** BigInt(scale);
    else {
      const divisor = 10n ** BigInt(-scale);
      need(value % divisor === 0n, 'RANGE_GRID');
      value /= divisor;
    }
    need(value >= 0n && value <= 1000000000000n, 'RANGE_UNIT_BOUND');
    return value;
  });
  need(out.length === 1326 && out.some((x) => x > 0n), 'RANGE_CENSUS');
  return out;
}
const gcd = (a: bigint, b: bigint): bigint => {
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return a;
};
function sameWeights(a: bigint[], b: readonly bigint[]) {
  let divisor = 0n;
  for (const w of a) if (w) divisor = gcd(divisor, w);
  need(divisor > 0n && a.every((w, i) => w / divisor === b[i]), 'ROOT_OPPONENT_WEIGHT_BINDING');
}
export function public215AllowedCombos(
  own: readonly bigint[],
  opponent: readonly bigint[],
  board: string
): number[] {
  const blocked = new Set(cards(board));
  const compatible = COMBOS.map((h, i) => ({ h, i })).filter(
    ({ h, i }) => opponent[i] > 0n && !h.some((c) => blocked.has(c))
  );
  return COMBOS.flatMap((h, i) =>
    own[i] > 0n &&
    !h.some((c) => blocked.has(c)) &&
    compatible.some((o) => !o.h.some((c) => h.includes(c)))
      ? [i]
      : []
  );
}
export function assemblePublic215Cached(
  own: readonly string[],
  board: string,
  template: CompiledPublic215Template,
  current: unknown,
  terminal: unknown
): number[] {
  for (const row of [current, terminal])
    need(
      Array.isArray(row) &&
        row.length === 3 &&
        row.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1) &&
        Math.abs(row.reduce((a, b) => a + b, 0) - 1) <= 1e-12,
      'CACHED_WTL_TRIPLE'
    );
  const result = [
    ...encodePublic215Base181(own, cards(board), template),
    ...(current as number[]),
    ...(terminal as number[]),
    ...encodePublic215State28(own, cards(board)),
  ];
  need(result.length === 215 && result.every(Number.isFinite), 'FINITE_215');
  return public215ContractVector(result, template);
}
/** NumPy v1.0, C-order little-endian float64, exact frame with no trailing bytes. */
export function public215NpyHeader(rows: number, columns = 215): Buffer {
  need(Number.isSafeInteger(rows) && rows > 0 && rows <= 57 * 1326, 'NPY_ROWS');
  // Every contract's width (v1 215, v2 246, v3 248); the caller passes the request's contract width.
  need(isPublic215FeatureCount(columns), 'NPY_COLUMNS');
  const dictionary = `{'descr': '<f8', 'fortran_order': False, 'shape': (${rows}, ${columns}), }`;
  const padding = (64 - ((10 + Buffer.byteLength(dictionary) + 1) % 64)) % 64;
  const header = Buffer.from(dictionary + ' '.repeat(padding) + '\n', 'ascii');
  const prefix = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, 0, 0]);
  prefix.writeUInt16LE(header.length, 8);
  return Buffer.concat([prefix, header]);
}
const f64 = (n: number): string => {
  need(Number.isFinite(n), 'FINITE_WORD');
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n);
  return b.toString('hex');
};
function atomicFile(path: string, bytes: Buffer | string): string {
  const temporary = path + '.' + randomUUID() + '.partial';
  const fd = openSync(temporary, 'wx');
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
  } finally {
    unlinkSync(temporary);
  }
  const parent = openSync(dirname(path), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
  return sha(bytes);
}
function sourceGraph(f: ObjectValue): string {
  const lock = jsonFile(f);
  object(lock, ['format', 'files']);
  need(
    lock.format === 'public_hist215_encoder_source_graph_v1' &&
      Array.isArray(lock.files) &&
      lock.files.length > 0,
    'ENCODER_GRAPH'
  );
  const seen = new Set<string>();
  for (const file of lock.files) {
    object(file, ['path', 'sha256']);
    need(
      !seen.has(file.path) && /\.(?:ts|js|mjs|json|cc|cpp|h|py)$/.test(file.path),
      'SOURCE_FILE'
    );
    pinned(file.path, file.sha256);
    seen.add(file.path);
  }
  return public215Digest(lock);
}
/** Metadata-only JSON identity preserves escaped compiler line breaks.
 * Numeric models/templates/index retain the strict printable-ASCII codec. */
export function public215CacheMetadataJson(value: unknown): string {
  const ordered = (v: any): any => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0)) return v;
    if (Array.isArray(v)) return v.map(ordered);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, ordered(v[k])])
      );
    throw Error('PUBLIC215_BATCH_CACHE_METADATA_VALUE');
  };
  return JSON.stringify(ordered(value));
}
/** Census a public cache declares for itself. R7 declared 107 contexts x 57
 * boards = 6,099 targets; later datasets (R8: 100 x 57) state their own,
 * and every consumer below checks against this declared census instead of
 * R7 constants. Boards per context stay 57 (3 folds x 19). */
export type Public215Census = { contexts: number; boardsPerContext: number; targets: number };
export function public215CacheCensus(batch: ObjectValue): Public215Census {
  const contexts = batch.contexts,
    boardsPerContext = batch.boards_per_context,
    targets = batch.planned_targets;
  need(
    Number.isSafeInteger(contexts) &&
      contexts > 0 &&
      boardsPerContext === 57 &&
      Number.isSafeInteger(targets) &&
      targets === contexts * boardsPerContext &&
      batch.completed_targets === targets,
    'PUBLIC_CACHE_CENSUS'
  );
  return { contexts, boardsPerContext, targets };
}
function readCache(f: ObjectValue, kind: 'current' | 'terminal', schema: ObjectValue): ObjectValue {
  object(f, ['path', 'sha256', 'header']);
  const batch = JSON.parse(pinned(f.path, f.sha256).toString('utf8'));
  const fields = schema[kind + '_header_fields'];
  need(Array.isArray(fields), 'CACHE_SCHEMA_HEADER');
  object(batch, fields);
  object(
    f.header,
    fields.filter((k: string) => k !== 'rows')
  );
  for (const key of fields)
    if (key !== 'rows')
      need(
        public215CacheMetadataJson(batch[key]) === public215CacheMetadataJson(f.header[key]),
        'CACHE_EXACT_HEADER_' + key
      );
  need(
    batch.contract === schema[kind + '_contract'] &&
      batch.solver_labels_used === false &&
      batch.qualityCertified === false,
    'PUBLIC_CACHE_IDENTITY'
  );
  const census = public215CacheCensus(batch);
  need(Array.isArray(batch.rows) && batch.rows.length === census.targets, 'CACHE_ROWS');
  return batch;
}
function extractCache(
  f: ObjectValue,
  kind: 'current' | 'terminal',
  schema: ObjectValue
): { header: ObjectValue; rows: Map<string, ObjectValue> } {
  // Only ONE parsed cache lives in this function. Retain compact f64 vectors,
  // never the millions of parsed three-element JS arrays or raw JSON bytes.
  const cache = readCache(f, kind, schema),
    result = new Map<string, ObjectValue>();
  for (const row of cache.rows) {
    object(row, schema[kind + '_row_fields']);
    need(
      typeof row.target_id === 'string' &&
        !result.has(row.target_id) &&
        Array.isArray(row.features) &&
        row.features.length === 1326,
      'CACHE_ROW_SHAPE'
    );
    const blocked = new Set(cards(row.board)),
      values = new Float64Array(1326 * 3);
    values.fill(NaN);
    for (let i = 0; i < 1326; i++) {
      const triple = row.features[i];
      if (COMBOS[i].some((c) => blocked.has(c))) {
        need(triple === null, 'BLOCKED_CACHE_NULL');
        continue;
      }
      need(
        Array.isArray(triple) &&
          triple.length === 3 &&
          triple.every(
            (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1
          ) &&
          Math.abs(triple.reduce((a: number, b: number) => a + b, 0) - 1) <= 1e-12,
        'CACHE_ALL_LEGAL_TRIPLES'
      );
      values.set(triple, i * 3);
    }
    const { features, ...metadata } = row;
    result.set(row.target_id, { ...metadata, values });
  }
  const { rows, ...header } = cache;
  return { header, rows: result };
}
export function assertPublic215CacheBinding(
  row: ObjectValue,
  target: ObjectValue,
  cid: string,
  t: CompiledPublic215Template
): void {
  const actor = t.rootActor === 'OOP' ? 0 : 1,
    opponent = actor === 0 ? 'IP' : 'OOP',
    oppSHA = actor === 0 ? t.ipRangeChecksum : t.oopRangeChecksum;
  need(
    row.context_id === cid &&
      row.board === target.board &&
      row.actor === actor &&
      row.opponent_solver_player === opponent &&
      row.opponent_range_sha256 === oppSHA,
    'CACHE_ROOT_PUBLIC_STATE'
  );
}
export function buildPublic215FeatureIndex(request: ObjectValue, output: string): ObjectValue {
  object(request, [
    'format',
    'feature_schema_checksum',
    'encoder_source_lock',
    'physics_checksum',
    'cache_schema',
    'current',
    'terminal',
    'contexts',
  ]);
  // The request's pinned descriptor names its contract (v1 215, v2 246, v3 248); the
  // request assembler writes the dataset's declared contract's descriptor.
  const contract = public215FeatureContractBySchema(request.feature_schema_checksum);
  need(
    request.format === 'public_hist215_public_feature_batch_request_v1' &&
      contract !== null &&
      validPublic215Digest(request.physics_checksum),
    'PUBLIC_REQUEST'
  );
  need(
    isAbsolute(output) &&
      resolve(output) === output &&
      !existsSync(output) &&
      realpathSync(dirname(output)) === dirname(output),
    'NEW_OUTPUT'
  );
  const encoder = sourceGraph(request.encoder_source_lock),
    schema = jsonFile(request.cache_schema);
  need(
    schema.contract === 'smarter-poker.public57-feature-batch-schema.v1',
    'CACHE_SCHEMA_VERSION'
  );
  const current = extractCache(request.current, 'current', schema);
  const terminal = extractCache(request.terminal, 'terminal', schema);
  need(
    terminal.header.base_current_feature_batch_sha256 === request.current.sha256,
    'CURRENT_PREFIX_BYTES'
  );
  const currentRows = current.rows,
    terminalRows = terminal.rows;
  const census = public215CacheCensus(current.header);
  need(
    JSON.stringify(public215CacheCensus(terminal.header)) === JSON.stringify(census),
    'CACHE_CENSUS_AGREES'
  );
  need(
    Array.isArray(request.contexts) && request.contexts.length === census.contexts,
    'CONTEXT_CENSUS'
  );
  const contextIDs = new Set<string>(),
    targetIDs = new Set<string>(),
    usedCache = new Set<string>();
  const prepared = [];
  for (const group of request.contexts) {
    object(group, [
      'context_id',
      'context',
      'template',
      'own_range',
      'opponent_range',
      'targets',
      'cases',
    ]);
    const cid = group.context_id;
    need(
      validPublic215Digest(cid) && cid === public215Digest(group.context) && !contextIDs.has(cid),
      'CONTEXT_SHA'
    );
    contextIDs.add(cid);
    const wire = jsonFile(group.template),
      template = compilePublic215Template(wire, group.template.sha256, contract!.version);
    need(public215Digest(template.context) === cid, 'TEMPLATE_CONTEXT');
    object(group.own_range, ['path', 'sha256']);
    object(group.opponent_range, ['path', 'sha256']);
    const ownSHA =
        template.rootActor === 'OOP' ? template.oopRangeChecksum : template.ipRangeChecksum,
      opponentSHA =
        template.rootActor === 'OOP' ? template.ipRangeChecksum : template.oopRangeChecksum;
    need(
      group.own_range.sha256 === ownSHA && group.opponent_range.sha256 === opponentSHA,
      'ROOT_RANGE_FILES'
    );
    const own = public215RangeUnits(pinned(group.own_range.path, ownSHA).toString('utf8')),
      opponent = public215RangeUnits(
        pinned(group.opponent_range.path, opponentSHA).toString('utf8')
      );
    sameWeights(opponent, template.normalizedWeights);
    need(
      Array.isArray(group.targets) &&
        group.targets.length === census.boardsPerContext &&
        Array.isArray(group.cases) &&
        group.cases.length >= 2 &&
        group.cases.length <= 32,
      'GROUP57_PUBLIC_CASES'
    );
    const localBoards = new Set<string>();
    const rows = [];
    let count = 0;
    for (const target of group.targets) {
      object(target, ['target_id', 'board', 'source_node', 'cache_target_id']);
      need(
        typeof target.target_id === 'string' &&
          /^[\x21-\x7e]{1,160}$/.test(target.target_id) &&
          !targetIDs.has(target.target_id) &&
          validPublic215SourceNode(target.source_node),
        'PUBLIC_TARGET'
      );
      targetIDs.add(target.target_id);
      need(
        !usedCache.has(target.cache_target_id) &&
          currentRows.has(target.cache_target_id) &&
          terminalRows.has(target.cache_target_id),
        'EXACT_CACHE_MAPPING'
      );
      usedCache.add(target.cache_target_id);
      const b = cards(target.board);
      need(
        b.length ===
          ({ flop: 3, turn: 4, river: 5 } as Record<string, number>)[template.context.street] &&
          !localBoards.has(target.board),
        'DISTINCT_CONTEXT_BOARDS'
      );
      localBoards.add(target.board);
      assertPublic215CacheBinding(currentRows.get(target.cache_target_id)!, target, cid, template);
      assertPublic215CacheBinding(terminalRows.get(target.cache_target_id)!, target, cid, template);
      const indices = public215AllowedCombos(own, opponent, target.board);
      need(indices.length > 0, 'ROOT_SUPPORT');
      rows.push({
        target_id: target.target_id,
        board: target.board,
        combo_indices: indices,
        offset: count,
        count: indices.length,
      });
      count += indices.length;
    }
    for (const c of group.cases) {
      object(c, ['board', 'own']);
      need(
        localBoards.has(c.board) && Array.isArray(c.own) && c.own.length === 2,
        'PUBLIC_CASE_BOARD'
      );
    }
    prepared.push({ group, cid, template, rows, count });
  }
  need(
    targetIDs.size === census.targets &&
      usedCache.size === census.targets &&
      contextIDs.size === census.contexts,
    'GLOBAL_EXACT_PUBLIC_DOMAIN'
  );
  mkdirSync(output);
  const groups = [];
  for (const { group, cid, template, rows, count } of prepared) {
    const width = contract!.featureCount,
      header = public215NpyHeader(count, width),
      data = Buffer.alloc(count * width * 8);
    let offset = 0;
    const encode = (board: string, own: readonly string[], cacheID: string) => {
      const a = currentRows.get(cacheID)!,
        b = terminalRows.get(cacheID)!;
      const ids = own.map((c) => DECK.indexOf(c));
      need(ids.length === 2 && ids.every((x) => x >= 0) && ids[0] !== ids[1], 'PUBLIC_CASE_OWN');
      const lo = Math.min(...ids),
        hi = Math.max(...ids),
        combo = (hi * (hi - 1)) / 2 + lo;
      return assemblePublic215Cached(
        own,
        board,
        template,
        Array.from(a.values.subarray(combo * 3, combo * 3 + 3)),
        Array.from(b.values.subarray(combo * 3, combo * 3 + 3))
      );
    };
    for (let j = 0; j < rows.length; j++)
      for (const combo of rows[j].combo_indices) {
        const features = encode(rows[j].board, COMBOS[combo], group.targets[j].cache_target_id);
        for (const value of features) {
          data.writeDoubleLE(value, offset);
          offset += 8;
        }
      }
    need(offset === data.length, 'NPY_DATA_FRAME');
    const matrixPath = join(output, cid + '.npy'),
      matrixSHA = atomicFile(matrixPath, Buffer.concat([header, data]));
    const cases = group.cases.map((c: ObjectValue) => ({
      board: c.board,
      own: c.own,
      features_f64: encode(
        c.board,
        c.own,
        group.targets.find((t: ObjectValue) => t.board === c.board).cache_target_id
      ).map(f64),
    }));
    groups.push({
      context_id: cid,
      context: group.context,
      template_checksum: group.template.sha256,
      matrix_path: matrixPath,
      matrix_sha256: matrixSHA,
      row_count: count,
      rows,
      cases,
    });
  }
  const result = {
    format: 'public_hist215_public_feature_index_v1',
    feature_schema_checksum: request.feature_schema_checksum,
    encoder_checksum: encoder,
    physics_checksum: request.physics_checksum,
    source_count: census.targets,
    context_count: census.contexts,
    dtype: '<f8',
    contexts: groups,
  };
  atomicFile(join(output, 'public-feature-index.json'), canonicalPublic215Json(result));
  return result;
}
function main(): void {
  const args = process.argv.slice(2);
  need(
    args.length === 6 &&
      args[0] === '--request' &&
      args[2] === '--request-sha256' &&
      args[4] === '--output',
    'CLI'
  );
  const request = JSON.parse(pinned(args[1], args[3]).toString('utf8'));
  const result = buildPublic215FeatureIndex(request, args[5]);
  console.log(
    JSON.stringify({
      output: join(args[5], 'public-feature-index.json'),
      sha256: public215Digest(result),
      contexts: result.context_count,
      targets: result.source_count,
      solver_labels_used: false,
      qualityCertified: false,
    })
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
