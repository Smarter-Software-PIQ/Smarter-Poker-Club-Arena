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
