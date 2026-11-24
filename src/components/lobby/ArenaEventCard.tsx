import { titleCase } from '../../utils/titleCase';
import type { ArenaGameCardActions, ArenaGameCardData } from './game-cards/arenaGameCardTypes';
import type { LobbyTournamentRow } from './lobbyEntries';
import { ArenaLobbyTitle, lobbyArtwork } from './ArenaLobbyTitle';
import { GameCardActions } from './game-cards/ArenaGameCard';
import trophy from './console-art/trophy.webp';
import diamond from './console-art/diamond.webp';
import chips from './console-art/chips.webp';
import ticket from './console-art/ticket.webp';
import './ArenaLobbyConsole.css';

export function ArenaEventCard({
  data,
  actions,
  destination,
}: {
  data: ArenaGameCardData;
  actions: ArenaGameCardActions;
  destination?: string | null;
}) {
  const entry = data.source;
  const row = entry?.raw as LobbyTournamentRow | undefined;
  const format = lobbyArtwork(row, entry?.kind);
  const art =
    format === 'satellite'
      ? ticket
      : format === 'spin'
        ? diamond
        : format === 'sng'
          ? chips
          : trophy;
  return (
    <article className="glp__arena-card arena-event-card" aria-label={data.title}>
      <ArenaLobbyTitle name={data.title} format={row} kind={entry?.kind} />
      <div className="arena-event-card__body">
        <img src={art} alt="" />
        <div>
          <strong className="arena-event-card__state">{titleCase(data.statusLabel)}</strong>
          <dl>
            {entry?.kind === 'mtt' && data.registered && (
              <div>
                <dt>Entries</dt>
                <dd>{data.registered}</dd>
              </div>
            )}
            {entry?.kind !== 'mtt' && data.players && (
              <div>
                <dt>Seated</dt>
                <dd>{titleCase(data.players)}</dd>
              </div>
            )}
            {data.buyIn && (
              <div>
                <dt>Buy-In</dt>
                <dd>{titleCase(data.buyIn)}</dd>
              </div>
            )}
            {destination && (
              <div>
                <dt>Seat Into</dt>
                <dd>{titleCase(destination)}</dd>
              </div>
            )}
            {data.guarantee && (
              <div>
                <dt>Guaranteed</dt>
                <dd>{data.guarantee}</dd>
              </div>
            )}
            {data.topPrize && (
              <div>
                <dt>Top Prize</dt>
                <dd>{data.topPrize.replace(/^top prize\s*/i, '')}</dd>
              </div>
            )}
            {data.maxPayout && (
              <div>
                <dt>Max Multiplier</dt>
                <dd>{data.maxPayout}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
      <GameCardActions actions={actions} />
    </article>
  );
}
