/**
 * omahaReadIsByStreetAndTexture: THE MODE OF ONE DECISION (2026-11-18, PLO Strategy lane).
 *
 * The only part of the per-street read HorseMind imports. It holds no computation: the mode
 * HorseOmahaReadByStreetRule installs for one decision carries the decision's street and flop
 * texture AND the two functions that read the street (HorseOmahaReadByStreet.ts), so HorseMind
 * (inside the Phase 11-13 policy digests' import closure) takes on no new runtime import. Off
 * (on: false, no functions) outside a decision and for every decision whose option is unset.
 */
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import type { FlopTexture, PostflopStreet, StreetReadCounters } from './HorseOmahaStreetRead.js';

/** The envelope means the label compares against (HorseOpponentExploit.exploitEnvelopeFor). */
export interface OmahaReadByStreetMeans {
  bet: number;
  foldToBet: number;
  riverCall: number;
}

export interface OmahaReadByStreetMode {
  readonly on: boolean;
  /** the decision's street; null off the postflop streets */
  readonly street: PostflopStreet | null;
  /** the flop's texture class; null when the board has no single known flop */
  readonly texture: FlopTexture | null;
  /** the pooled read with its value-leader label read on this street (HorseOmahaReadByStreet) */
  readonly readConditional?: (
    pooled: OmahaReadConditional | null,
    row: StreetReadCounters | null,
    means: OmahaReadByStreetMeans | null
  ) => OmahaReadConditional | null;
  /** his bet rate on this street shrunk toward `pooledRate` (HorseOmahaReadByStreet) */
  readonly betRate?: (row: StreetReadCounters | null, pooledRate: number) => number;
}
export const OMAHA_READ_BY_STREET_OFF: OmahaReadByStreetMode = Object.freeze({
  on: false,
  street: null,
  texture: null,
});
let current: OmahaReadByStreetMode = OMAHA_READ_BY_STREET_OFF;

export function withOmahaReadByStreet<T>(mode: OmahaReadByStreetMode, fn: () => T): T {
  const previous = current;
  current = mode;
  try {
    return fn();
  } finally {
    current = previous;
  }
}
export function omahaReadByStreetNow(): OmahaReadByStreetMode {
  return current;
}
