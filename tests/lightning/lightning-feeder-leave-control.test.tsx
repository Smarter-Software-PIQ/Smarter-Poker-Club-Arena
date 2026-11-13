/**
 * Dan 2026-11-13: "THE LEAVE NEXT HAND BUTTON IS MISSING FROM NO LIMIT
 * LIGHTNING GAMES." Before a Lightning game has enough players it is an
 * ordinary table, and the Lightning control only existed inside a running
 * pool. The feeder control is the same button through the ordinary
 * leave-after-this-hand, and TablePage shows it on every Lightning-capable
 * table a seated player is at outside a pool.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lightning/lightningSessionApi', () => ({ stopLightningPlaying: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => ({ warning: vi.fn() }) }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
import { LightningFeederLeaveControl } from '../../src/components/lightning/LightningLeaveControl';
afterEach(cleanup);

describe('Leave Next Hand before Lightning starts', () => {
  it('arms the ordinary leave-after-this-hand on tap', () => {
    const leave = vi.fn();
    const cancel = vi.fn();
    render(
      <LightningFeederLeaveControl
        queued={false}
        pending={false}
        onLeave={leave}
        onCancel={cancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave Next Hand' }));
    expect(leave).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });
  it('a second tap while armed keeps the player at the table', () => {
    const leave = vi.fn();
    const cancel = vi.fn();
    render(
      <LightningFeederLeaveControl queued pending={false} onLeave={leave} onCancel={cancel} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leaving After Hand' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
  });
  it('cannot be pressed while the request is in flight', () => {
    render(<LightningFeederLeaveControl queued pending onLeave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Leaving...' })).toBeDisabled();
  });
  it('TablePage shows it on a Lightning-capable table to a seated player outside a pool', () => {
    const page = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
    expect(page).toMatch(
      /\) : lightningCapableClusterId && heroIsSeated && userId && userId !== 'guest' \? \(\s*(\/\*[\s\S]*?\*\/\s*)?<LightningFeederLeaveControl\s+queued=\{leaveNextHand\.queued\}\s+pending=\{leaveNextHand\.pending\}\s+onLeave=\{requestLeaveAtNextHand\}/
    );
  });
});
