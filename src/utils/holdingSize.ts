import type { ReplayModel } from './handReplay';

/** How many face-down cards an unrevealed seat shows: the variant's holding. */
export function holdingSize(model: ReplayModel): number {
  const shown = model.players.find((p) => p.hole && p.hole.length > 0)?.hole?.length;
  if (shown) return shown;
  const v = String(model.gameVariant || '').toLowerCase();
  if (v.startsWith('plo6')) return 6;
  if (v.startsWith('plo5')) return 5;
  if (v.startsWith('plo') || v.startsWith('flo')) return 4;
  if (v.includes('pineapple')) return 3;
  return 2;
}
