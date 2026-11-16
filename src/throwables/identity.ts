import { throwSeed } from '../lib/sharedThrows';
/** Optional metadata beside the unchanged legacy chat message text. */
export function isThrowableEventId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

const ANSWERS = [
  ['ASK AGAIN', 'LATER'],
  ['OUTLOOK NOT', 'SO GOOD'],
  ['IT IS', 'CERTAIN'],
] as const;

/** Integer arithmetic gives all clients the same answer for the same throw. */
export function magicEightBallAnswer(throwId: string, seed?: number): readonly string[] {
  return ANSWERS[(seed ?? throwSeed(throwId.toLowerCase())) % ANSWERS.length];
}
