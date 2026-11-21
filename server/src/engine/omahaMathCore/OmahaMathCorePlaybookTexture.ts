/**
 * omahaMathCore component (lane PLAYBOOK, lead session 01TLQer8, Nov 19 2026): BOARD TEXTURE.
 *
 * The core's fold cells (responseTo) are keyed street / line / size band / players / mode but not by
 * the board. Responders fold far more on some boards than others at the same size (48h, PLO4+PLO5
 * cash, persons facing a Horse heads-up flop bet of <= 0.4 pot: paired-rainbow 0.29 (n=28),
 * paired-two-tone 0.32 (25), unpaired-two-tone 0.21 (161), unpaired-rainbow 0.13 (119), all 0.19 (338)).
 *
 * playbookTexture.v2-pooled.json (provenance public_actions: boards and public actions only) holds the
 * fold share by street|texture|band|players plus the texture-free base cell ('all'), every responder
 * pooled (lane CORE-POOLED: v1's responder-kind cells summed by n; no person/Horse field). The texture
 * cell is shrunk to its base, (k + M x base) / (n + M), M = 20, and applied to the core's own fold
 * probability as a RATIO:
 *   p' = p x shrunk(texture) / base
 * Holdout (fit before 2026-11-19 06:01Z, scored after, 842 responses): log loss 0.6286 base -> 0.6258.
 *
 * Pure, never throws: no cell (base n < 30) or bad input returns p unchanged with the reason.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The table is read from the source tree at load, not imported: the engine image is compiled by
// tsconfig.emit.json (noResolve, explicit files) under a 1 GB heap, where importing these tables is either not
// emitted (the file is missing from dist and the import fails at boot) or exhausts the compiler's heap. The
// image holds src/ beside dist/ (Dockerfile COPY src/; the hashed policy sources are read the same way), so
// the server root is three levels above this module in both trees. Where the module's own URL is not a file
// URL (the root test suite runs under happy-dom), the table is found from the working directory: the server
// root, or the repository root above it.
function omahaMathCoreTable(name: string): unknown {
  const at = `src/engine/omahaMathCore/${name}`;
  const here = String(import.meta.url);
  const candidates = [
    ...(here.startsWith('file:') ? [fileURLToPath(new URL(`../../../${at}`, here).href)] : []),
    join(process.cwd(), at),
    join(process.cwd(), 'server', at),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      `omahaMathCore: table ${name} is not beside the engine (${candidates.join(', ')})`
    );
  return JSON.parse(readFileSync(found, 'utf8'));
}
const textureJson: unknown = omahaMathCoreTable('playbookTexture.v2-pooled.json');

export const PLAYBOOK_TEXTURE_VERSION = 'playbook-texture-v2-pooled';

interface TextureTable {
  version: string;
  provenance: string;
  shrinkM: number;
  minBaseN: number;
  cells: Record<string, { n: number; fold: number }>;
}
export const PLAYBOOK_TEXTURE_TABLE = textureJson as unknown as TextureTable;

export type TextureClass =
  | 'paired_flush3'
  | 'paired_twotone'
  | 'paired_rainbow'
  | 'unpaired_flush3'
  | 'unpaired_twotone'
  | 'unpaired_rainbow';

/** Texture of a board of integer cards (card = rank * 4 + suit). */
export function boardTexture(board: readonly number[]): TextureClass | null {
  if (board.length < 3 || board.length > 5) return null;
  const ranks = new Set<number>();
  const suits = [0, 0, 0, 0];
  for (const c of board) {
    if (!Number.isInteger(c) || c < 0 || c > 51) return null;
    ranks.add(c >> 2);
    suits[c & 3]++;
  }
  const paired = ranks.size < board.length;
  const m = Math.max(...suits);
  const s = m >= 3 ? 'flush3' : m === 2 ? 'twotone' : 'rainbow';
  return `${paired ? 'paired' : 'unpaired'}_${s}` as TextureClass;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Texture-adjusted fold probability facing a postflop wager (every responder pooled). */
export function textureFold(k: {
  street: 'flop' | 'turn' | 'river';
  board: readonly number[];
  band: 'small' | 'half' | 'twothirds' | 'pot' | 'allin';
  players: 'hu' | 'mw';
  p: number;
}): { p: number; source: string } {
  const p = clamp01(k.p);
  try {
    const t = PLAYBOOK_TEXTURE_TABLE;
    const tex = boardTexture(k.board);
    if (!tex) return { p, source: 'texture: bad board, unchanged' };
    if (p <= 0 || p >= 1) return { p, source: 'texture: fold 0 or 1, unchanged' };
    const baseKey = `${k.street}|all|${k.band}|${k.players}`;
    const base = t.cells[baseKey];
    if (!base || base.n < t.minBaseN || !(base.fold > 0) || !(base.fold < 1))
      return { p, source: `texture: no base cell ${baseKey}, unchanged` };
    const key = `${k.street}|${tex}|${k.band}|${k.players}`;
    const c = t.cells[key];
    const n = c?.n ?? 0;
    const shrunk = ((c ? c.fold * n : 0) + t.shrinkM * base.fold) / (n + t.shrinkM);
    const out = clamp01((p * shrunk) / base.fold);
    return {
      p: out,
      source: `texture ${tex}: fold ${r3(p)} x ${r3(shrunk)}/${r3(base.fold)} = ${r3(out)} [${key} n=${n} shrunk to ${baseKey} n=${base.n}; ${t.version}]`,
    };
  } catch (e) {
    return { p, source: `texture error (${(e as Error).message}): unchanged` };
  }
}
