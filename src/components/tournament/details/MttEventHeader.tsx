import type { ComponentProps, ReactNode } from 'react';
import { titleCase } from '../../../utils/titleCase';
import { ArenaLobbyTitle } from '../../lobby/ArenaLobbyTitle';

import { TournamentRegisterButton } from '../TournamentRegisterButton';

interface Props extends ComponentProps<typeof ArenaLobbyTitle> {
  status: string;
  price: ReactNode;
  terms: string;
  info?: ReactNode;
  actions?: ReactNode;
  close?: ReactNode;
  onInvite: () => void;
}

export function MttEventHeader({
  name,
  format,
  status,
  price,
  terms,
  info,
  actions,
  close,
  onInvite,
}: Props) {
  return (
    <header className="details-header">
      <h1 className="tournament-name">
        <ArenaLobbyTitle name={name} format={format} />
      </h1>
      <div className="mtt-meta">
        <b>{titleCase(status)}</b>
        <div className="mtt-price">{price}</div>
        <div className="mtt-meta-actions">
          <TournamentRegisterButton
            className="btn-invite-game"
            data-testid="tournament-invite-btn"
            onClick={onInvite}
          >
            Invite To Game
          </TournamentRegisterButton>
          {close}
        </div>
      </div>
      {info ? (
        <details className="mtt-header-info">
          <summary>{titleCase(terms || 'Event Information')}</summary>
          {info}
        </details>
      ) : (
        <small>{titleCase(terms)}</small>
      )}
      {actions && <div className="details-header__actions">{actions}</div>}
    </header>
  );
}
