/**
 * HIT AND RUN, THE PLAYER'S SIDE (owner 2026-11-06).
 *
 *   "THOSE 10 HANDS SHOULD BE DISPLAYED AND COUNTED DOWN AFTER THE COMPLETION
 *    OF EACH HAND ... IF THEY TRY TO LEAVE THE GAME BEFORE THE HANDS ARE
 *    COMPLETED, THEY SHOULD RECEIVE A FULL SCREEN POP UP THAT SAYS, YOUR HAND
 *    COUNT IS NOT COMPLETED, ARE YOU SURE YOU WANT TO LEAVE? YOU WILL BE
 *    BLINDED OFF FOR THE REMAINING HANDS."
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import HitRunLeaveConfirm from '../src/components/table/HitRunLeaveConfirm';
import HeroVpipTracker from '../src/components/table/HeroVpipTracker';
import {
  blindOffLeaveText,
  handsRemainingText,
  owedHands,
  HIT_RUN_COUNT_LABEL,
} from '../src/lib/hitAndRun';
import { mapEngineSnapshot } from '../src/utils/mapEngineSnapshot';

afterEach(cleanup);
const read = (p: string) => readFileSync(p, 'utf8');

describe('the full screen confirmation', () => {
  it('says the owner words, shows the count, and Stay changes nothing', () => {
    const onStay = vi.fn();
    const onLeave = vi.fn();
    render(<HitRunLeaveConfirm handsRemaining={7} onStay={onStay} onLeave={onLeave} />);
    const dialog = screen.getByTestId('hit-run-confirm');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.textContent).toContain('Your Hand Count Is Not Completed');
    expect(dialog.textContent).toContain('Are You Sure You Want To Leave?');
    expect(dialog.textContent).toContain('You Will Be Blinded Off For The Remaining Hands.');
    expect(screen.getByTestId('hit-run-confirm-count').textContent).toContain('7 Hands Remaining');
    fireEvent.click(screen.getByText('Stay And Play'));
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('Leave confirms once', async () => {
    const onLeave = vi.fn(async () => undefined);
    render(<HitRunLeaveConfirm handsRemaining={1} onStay={() => {}} onLeave={onLeave} />);
    expect(screen.getByTestId('hit-run-confirm-count').textContent).toContain('1 Hand Remaining');
    const leave = screen.getByRole('button', { name: 'Leave' });
    fireEvent.click(leave);
    fireEvent.click(leave);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no hands are owed', () => {
    const { container } = render(
      <HitRunLeaveConfirm handsRemaining={null} onStay={() => {}} onLeave={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  // Owner 2026-11-10 superseded "fully opaque": "UPGRADE THIS POP UP
  // NOTIFICATION TO LOOK LIKE THE OTHERS, ITS BLOCKING THE WHOLE SCREEN, AND
  // IS NOT SMARTER.POKER LOOK AND FEEL." It covers the screen as a modal, on a
  // translucent scrim so the table stays in view, and is the spade console.
  it('covers the screen on a translucent scrim, on the spade console, with no yellow', () => {
    const css = read('src/components/table/HitRunLeaveConfirm.css').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );
    expect(css).toMatch(/\.hit-run-confirm \{[^}]*position: fixed;[^}]*inset: 0;/s);
    const backdrop = /\.hit-run-confirm \{([^}]*)\}/s.exec(css)?.[1] ?? '';
    const alpha = /background: rgb\(0 0 0 \/ (\d+)%\)/.exec(backdrop);
    expect(alpha).not.toBeNull();
    expect(Number(alpha![1])).toBeLessThan(80);
    expect(backdrop).not.toContain('gradient');
    expect(css).not.toContain('border-radius: 2');
    expect(css.toLowerCase()).not.toMatch(/yellow|#ff0|#ffd|#fc0|#facc15|#eab308/);
    const source = read('src/components/table/HitRunLeaveConfirm.tsx');
    expect(source).toContain('<SpadeConsole');
    expect(source).toContain('buttonRef: stayRef');
  });
});

describe('the count and its copy', () => {
  it('reads only positive whole hand counts', () => {
    expect(owedHands(7)).toBe(7);
    expect(owedHands('3')).toBe(3);
    expect(owedHands(0)).toBeNull();
    expect(owedHands(null)).toBeNull();
    expect(owedHands(-2)).toBeNull();
    expect(handsRemainingText(10)).toBe('10 Hands Remaining');
    expect(blindOffLeaveText(4)).toBe(
      'You Are Blinded Off For The Remaining 4 Hands. Your Chips Return To Your Wallet When They Are Played'
    );
    for (const text of [handsRemainingText(2), blindOffLeaveText(2), HIT_RUN_COUNT_LABEL]) {
      expect(text).not.toContain('—');
      expect(text).not.toContain('$');
    }
  });

  it('the hero seat payload carries the engine count; absent means not reported', () => {
    const base = {
      table_id: 't',
      hand_number: 4,
      pot: 0,
      stage: 'preflop',
      current_player: null,
      dealer_seat: 1,
      max_seats: 6,
      players: [
        {
          seat: 1,
          user_id: 'hero',
          username: 'H',
          stack: 300,
          cards: [],
          hit_run_hands_remaining: 6,
        },
      ],
      community_cards: [],
      action_history: [],
      side_pots: [],
      winners: [],
      disconnect_states: {},
    } as any;
    expect(mapEngineSnapshot(base, 'hero', 6).heroHandsOwed).toBe(6);
    base.players[0].hit_run_hands_remaining = null;
    expect(mapEngineSnapshot(base, 'hero', 6).heroHandsOwed).toBeNull();
    delete base.players[0].hit_run_hands_remaining;
    expect(mapEngineSnapshot(base, 'hero', 6).heroHandsOwed).toBeUndefined();
  });

  it('the felt counts it down beside the hero', () => {
    const plane = document.createElement('div');
    document.body.appendChild(plane);
    render(
      <HeroVpipTracker
        tableId="t"
        heroSeated
        isTournament={false}
        handNumber={0}
        heroPos={{ x: 50, y: 80 }}
        handsOwed={8}
      />,
      { container: plane }
    );
    const count = screen.getByTestId('hero-hand-count');
    expect(count.textContent).toContain(HIT_RUN_COUNT_LABEL);
    expect(count.textContent).toContain('8');
  });
});

describe('every leave door asks first (TablePage source pins)', () => {
  const page = read('src/pages/TablePage.tsx');
  it('the menu, leave-after-this-hand and tab X doors check the count before anything is sent', () => {
    const leave = page.slice(page.indexOf('const handleLeaveTable = async'));
    expect(leave.indexOf('await handsOwedBeforeLeave()')).toBeGreaterThan(-1);
    expect(leave.indexOf('await handsOwedBeforeLeave()')).toBeLessThan(
      leave.indexOf('stopLightningForLeave()')
    );
    const tab = page.slice(page.indexOf('const handleForceLeaveTable = async'));
    expect(tab.indexOf('await handsOwedBeforeLeave()')).toBeLessThan(
      tab.indexOf('stopLightningForLeave()')
    );
    expect(page).toContain(
      'hitRunConfirmedRef.current = true;\n          await handleLeaveTable();'
    );
    expect(page).toContain('const confirmedHandCount = hitRunConfirmedRef.current;');
    // A confirmed Lightning leave keeps being matched: it is blinded off.
    expect(page).toContain('if (!confirmedHandCount && !(await stopLightningForLeave())) {');
  });
});
