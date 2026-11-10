export const PLO_LIGHTNING_GAME = 'c79d8ec2-2281-411d-b4e1-42b5610849e2';
export type PloLightningDemand = {
  game_id: typeof PLO_LIGHTNING_GAME;
  event_id: string | null;
  continues: boolean;
  wind_down: boolean;
};

/** Continuation is demand, never a synthetic human. */
export function ploContinuationFor(gameId: unknown, demand: PloLightningDemand | null): boolean {
  return gameId === PLO_LIGHTNING_GAME && demand?.continues === true;
}

/** A human anywhere in the game protects every table, including sit-outs. */
export function ploWindDownFor(
  gameId: unknown,
  demand: PloLightningDemand | null,
  occupiedHumanGames: ReadonlySet<string>
): boolean {
  return (
    gameId === PLO_LIGHTNING_GAME &&
    demand?.wind_down === true &&
    !occupiedHumanGames.has(PLO_LIGHTNING_GAME)
  );
}

/** The admission transaction still owns the deadline and ten-player cap.
 * Widen only activity-hour texture, using the caller's already qualified pool. */
export function ploActivityPool<T>(
  gameId: unknown,
  humanGames: ReadonlySet<string> | null,
  demand: PloLightningDemand | null,
  awake: T[],
  sittable: T[],
  needed: number
): T[] {
  return awake.length < needed &&
    gameId === PLO_LIGHTNING_GAME &&
    (humanGames?.has(PLO_LIGHTNING_GAME) || ploContinuationFor(gameId, demand))
    ? sittable
    : awake;
}
