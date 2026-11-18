/**
 * THE LEAGUE LEARNS THE STREET READ (2026-11-18, PLO Strategy lane, for omahaReadIsByStreetAndTexture).
 *
 * In production the per-street, per-texture read reaches a decision through the accepted-hand database
 * learner and the pooled public row (the exact profile street record -> HorseMindSandbox.pooledStreetRead).
 * A league hand has neither, so a card for an option that reads it would play two identical arms. This is the
 * league's stand-in for that learner: after each completed hand, inside the card's own sandbox, the same pure
 * reducer the database twin mirrors (streetReadHandIncrements + addStreetReadEvidence) adds the hand to each
 * acting seat's row, keyed exactly as HorseMind.omahaStreetReadOf reads it. It runs only for a hand in which a
 * seat's configuration carries the option, so every other card is untouched. League actions are all the seat's
 * own choices, so a fold is admitted as the player's (origin 'player'), as production journals it.
 */
import type { Card } from '../types.js';
import type { HorseMindSandbox } from '../engine/HorseMind.js';
import type { ExploitHandAction } from '../engine/HorseOpponentExploit.js';
import { addStreetReadEvidence, streetReadHandIncrements } from '../engine/HorseOmahaStreetRead.js';
import {
  memoryVariant,
  opponentMemoryKey,
  type MemorySize,
} from '../engine/HorseOpponentMemory.js';

export function leagueLearnStreetRead(
  sandbox: HorseMindSandbox,
  history: ReadonlyArray<{ userId?: string; action: string; stage: string; isFullRaise?: boolean }>,
  board: readonly Card[],
  gameVariant: string,
  scope: string
): void {
  const variant = memoryVariant(gameVariant);
  const size = scope.split(':')[1] as MemorySize | undefined;
  if (!variant || !size) return;
  const actions = history.map((a) =>
    a.action === 'fold' ? { ...a, origin: 'player' } : { ...a }
  ) as unknown as ExploitHandAction[];
  const increments = streetReadHandIncrements(actions, board.slice(0, 3));
  if (increments.size === 0) return;
  const map = (sandbox.pooledStreetRead ??= new Map());
  for (const [userId, inc] of increments) {
    const key = opponentMemoryKey(userId, variant, 'cash', size);
    const next = addStreetReadEvidence(map.get(key) ?? null, inc);
    if (next) map.set(key, next);
  }
}
