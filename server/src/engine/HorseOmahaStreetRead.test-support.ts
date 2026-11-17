/**
 * Shared by HorseOmahaStreetReadVectors.test.ts and server/scripts/generate-horse-street-read-vectors.ts: how a
 * hand in scripts/ci/fixtures/horse-street-read-vectors.json is read, and what the engine reducer makes of it.
 */
import type { ExploitHandAction } from './HorseOpponentExploit.js';
import {
  publicFlopOfHistory,
  streetReadHandIncrements,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';

export interface StreetReadVectorAction {
  userId?: unknown;
  stage?: unknown;
  action?: unknown;
  origin?: unknown;
  isFullRaise?: unknown;
}

/** "userId,stage,action,origin,isFullRaise" tokens, "-" for an absent field, 1/0 for true/false. */
export function decodeStreetReadLog(log: string): StreetReadVectorAction[] {
  return log
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const [userId, stage, action, origin, full] = token.split(',');
      return {
        ...(userId === '-' ? {} : { userId }),
        stage,
        action,
        ...(origin === '-' ? {} : { origin }),
        ...(full === '-' ? {} : { isFullRaise: full === '1' }),
      };
    });
}

/** One hand of public history through the engine reducer: the action log and the hand's board columns. */
export function engineStreetReadIncrements(
  actions: unknown,
  communityCards: unknown,
  communityCards2: unknown
): Map<string, StreetReadCounters> {
  return streetReadHandIncrements(
    (Array.isArray(actions) ? actions : []) as ExploitHandAction[],
    publicFlopOfHistory(communityCards, communityCards2)
  );
}
