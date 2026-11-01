import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cashEntry, type LobbyTableRow } from '../src/components/lobby/lobbyEntries';
import { arenaGameCardActionsForEntry } from '../src/components/lobby/game-cards/ArenaLobbyGameCard';
import { arenaGameCardDataFromEntry } from '../src/components/lobby/game-cards/arenaGameCardAdapter';
import ArenaGameCard from '../src/components/lobby/game-cards/ArenaGameCard';
import type { LobbyRowContext } from '../src/components/lobby/lobbyCardContext';

vi.mock('../src/services/tableWarmup', () => ({ warmTable: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
afterEach(cleanup);
const variants = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flh',
  'flo8',
  'short_deck',
  'pineapple',
  'limit_holdem',
  'limit_omaha',
];
const modes = ['manual', 'must_move', 'lightning', 'pending_on', 'draining', 'paused'];
const row = (variant: string, mode: string, status = 'running') =>
  cashEntry({
    id: 'public-table',
    name: 'Public Game',
    game_variant: variant,
    small_blind: 2,
    big_blind: 5,
    min_buy_in: 500,
    max_buy_in: 1000,
    current_players: 6,
    max_players: 6,
    status,
    ...(mode === 'manual'
      ? {}
      : {
          cluster_id: 'game',
          role: 'main',
          main_index: 1,
          cluster_mode: mode,
          cluster_template: 'action',
          cluster_players: 6,
          cluster_tables: 1,
        }),
  } as LobbyTableRow);
const context = () =>
  ({
    seatedIds: new Set(),
    waitlistedIds: new Set(),
    registeredIds: new Set(),
    onViewTable: vi.fn(),
    onJoinTable: vi.fn(),
    onWaitlistToggle: vi.fn(),
  }) as unknown as LobbyRowContext;

describe('cash viewing is a spectator action for every card', () => {
  for (const presentation of ['desktop', 'mobile'] as const) {
    for (const variant of variants) {
      it.each(modes)(`${presentation} ${variant} %s views without joining`, (mode) => {
        const entry = row(variant, mode);
        const ctx = context();
        const actions = arenaGameCardActionsForEntry(entry, ctx);
        render(
          <ArenaGameCard
            data={arenaGameCardDataFromEntry(entry)}
            actions={actions}
            presentation={presentation}
          />
        );
        fireEvent.click(screen.getByRole('button', { name: actions.secondaryLabel }));
        expect(ctx.onViewTable).toHaveBeenCalledExactlyOnceWith(entry);
        expect(ctx.onJoinTable).not.toHaveBeenCalled();
        expect(ctx.onWaitlistToggle).not.toHaveBeenCalled();
      });
      it(`${presentation} ${variant} cannot silently click a missing or busy viewer`, () => {
        const entry = row(variant, 'manual');
        const ctx = context();
        ctx.actionBusy = true;
        const actions = arenaGameCardActionsForEntry(entry, ctx);
        const view = render(
          <ArenaGameCard
            data={arenaGameCardDataFromEntry(entry)}
            actions={actions}
            presentation={presentation}
          />
        );
        const button = screen.getByRole('button', {
          name: actions.secondaryLabel,
        }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(ctx.onViewTable).not.toHaveBeenCalled();
        view.rerender(
          <ArenaGameCard
            data={arenaGameCardDataFromEntry(entry)}
            actions={{ primaryLabel: 'Preview', secondaryLabel: 'View Game' }}
            presentation={presentation}
          />
        );
        expect(
          (screen.getByRole('button', { name: 'View Game' }) as HTMLButtonElement).disabled
        ).toBe(true);
      });
    }
  }
  it.each(['closed', 'full', 'waiting', 'running'])(
    '%s keeps viewing separate from admission',
    (status) => {
      const entry = row('plo5', 'must_move', status);
      const ctx = context();
      arenaGameCardActionsForEntry(entry, ctx).onSecondary!();
      expect(ctx.onViewTable).toHaveBeenCalledExactlyOnceWith(entry);
      expect(ctx.onJoinTable).not.toHaveBeenCalled();
      expect(ctx.onWaitlistToggle).not.toHaveBeenCalled();
    }
  );
});
