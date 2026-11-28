/**
 * POKER ARENA LANDING PAGE IS PINNED BEFORE ITS FRAMES MOVE
 * (#SmarterDesign batch H1, 2026-11-28)
 *
 * / (signed-out public PokerArenaLandingPage) moves from five painted
 * SpadeConsole frames to the arena workspace while staying 100% static and
 * prerender-safe. The hero console head (eyebrow, title, subtitle, pill) moves
 * into ArenaWorkspaceHeader and section eyebrows retire with SpadeConsole;
 * every feature, step, trust paragraph, resource link, anchor CTA and
 * analytics call is pinned unchanged.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfacePin } from '../helpers/surfacePin';

const captureMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/analytics', () => ({
  capture: captureMock,
}));

import PokerArenaLandingPage from '../../src/pages/PokerArenaLandingPage';

function landingPin(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  // The hero console head moves into ArenaWorkspaceHeader, and each section's
  // redundant console eyebrow retires with SpadeConsole.
  const heroHead = clone.querySelector('.sc > .sc__head');
  if (heroHead && heroHead.textContent?.includes('Poker Arena')) {
    heroHead.remove();
  }
  for (const el of clone.querySelectorAll('.sc__eyebrow')) el.remove();
  return surfacePin(clone);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
});

afterEach(cleanup);

describe('PokerArenaLandingPage prints the same words, links and CTA analytics', () => {
  it('renders the full public landing surface unchanged', () => {
    const { container } = render(
      <MemoryRouter>
        <PokerArenaLandingPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Poker Arena' })).toBeInTheDocument();
    expect(landingPin(container)).toMatchInlineSnapshot(`
      {
        "controls": [
          "a||Create Account|",
          "a||Create Account|",
          "a||Fair Gaming|",
          "a||Help Center|",
          "a||Privacy Policy|",
          "a||Promotion Rules|",
          "a||Sign In|",
          "a||Sign In|",
          "a||Smarter.Poker World Hub|",
          "a||Terms Of Service|",
        ],
        "money": {
          "figures": [
            "1",
            "2",
            "3",
          ],
          "hooks": [
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
            "data-discover=true",
          ],
        },
        "regions": [
          "nav||Poker Arena Resources",
        ],
        "text": "Create Or Join A Private Poker Club, Play Real Time Cash Games And Tournaments With Your Own Players, And Run The Whole Club From One Dashboard. | A Free Smarter.Poker Account Opens Every Club, Table And Tournament In The Arena. | Everything A Club Needs | Six | Private Poker Clubs | Create A Club, Set Your Own Stakes And Rules, Invite Your Players And Keep Every Game Inside Your Own Walls. | Real Time Cash Games | Hold'em, Omaha, Short Deck And Pineapple At Tables That Deal In Real Time, With Straddles, Bomb Pots, Run It Twice And Insurance. | Tournaments | Schedule Multi Table Tournaments With Custom Blind Structures, Rebuys, Bounties And Automatic Payouts. | Hand Histories And Stats | Every Hand Is Recorded. Replay It, Share It And Study Player Statistics And Leaderboards Across Your Club. | Club Management | A Cashier, Chip Ledger, Agent System, Rake Settings, Reports And Settlement Tools Built For Club Owners. | Unions And Diamond Arena | Link Clubs Into Unions For Shared Player Pools. Diamond Arena Membership Is Automatic, But Funded Diamond Games Are Not Open For Play Yet. | How Poker Arena Works | Three | 1 | Create Your Free Account | One Smarter.Poker Account Opens Poker Arena And Every Other Feature On The Platform. | 2 | Create Or Join A Club | Start Your Own Club In Minutes Or Join One With An Invite Code From Its Owner. | 3 | Sit Down And Play | Open The Lobby, Pick A Table Or Tournament And Play From Your Browser Or The Mobile App. | Fair Play, In Writing | Public | Every Table Runs On A Server Side Shuffle With Collusion Detection And Anti Cheat Monitoring. The Rules Are Public: Read The Fair Gaming Standards, The Terms Of Service And The Privacy Policy Before You Sit Down. | Ready To Deal? | Free | Sign In To Poker Arena, Or Create A Free Account And Open Your First Club In Minutes.",
      }
    `);
  });

  it('tracks landing_viewed and all four hero/closing CTA clicks with real anchor hrefs', () => {
    render(
      <MemoryRouter>
        <PokerArenaLandingPage />
      </MemoryRouter>
    );
    expect(captureMock).toHaveBeenCalledWith(
      'landing_viewed',
      expect.objectContaining({ product: 'poker_arena' })
    );

    const signIns = screen.getAllByRole('link', { name: 'Sign In' });
    const signUps = screen.getAllByRole('link', { name: 'Create Account' });
    expect(signIns).toHaveLength(2);
    expect(signUps).toHaveLength(2);
    for (const a of [...signIns, ...signUps]) {
      expect(a.getAttribute('href')).toBeTruthy();
    }

    fireEvent.click(signIns[0]);
    fireEvent.click(signUps[0]);
    fireEvent.click(signIns[1]);
    fireEvent.click(signUps[1]);

    expect(captureMock).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'sign_in',
      placement: 'hero',
      product: 'poker_arena',
    });
    expect(captureMock).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'sign_up',
      placement: 'hero',
      product: 'poker_arena',
    });
    expect(captureMock).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'sign_in',
      placement: 'closing',
      product: 'poker_arena',
    });
    expect(captureMock).toHaveBeenCalledWith('landing_cta_clicked', {
      cta: 'sign_up',
      placement: 'closing',
      product: 'poker_arena',
    });
  });
});
