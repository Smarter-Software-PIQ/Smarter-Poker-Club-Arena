import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LeakPanel from '../../src/components/stats/LeakPanel';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Club Arena <-> Personal Assistant Leak Finder wiring', () => {
  it('HandHistoryPage routes Jarvis handoff to /hub/personal-assistant/leaks by hand ID (never 404 /hub/jarvis)', () => {
    const source = read('src/pages/HandHistoryPage.tsx');
    expect(source).toContain(
      '/hub/personal-assistant/leaks?source=club-arena&hand=${encodeURIComponent(hand.id)}'
    );
    expect(source).not.toContain('/hub/jarvis');
    expect(source).toContain(
      "masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: userId ?? undefined });"
    );
  });

  it('AnalysisTab opens Personal Assistant Leak Finder via hub tab during live play or browser otherwise', () => {
    const source = read('src/pages/stats/AnalysisTab.tsx');
    expect(source).toContain('/hub/personal-assistant/leaks?source=club-arena-stats');
    expect(source).toContain("masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: targetUserId });");
    expect(source).toContain('onOpenLeakFinder={openLeakFinder}');
  });

  it('LeakPanel renders the Personal Assistant Leak Finder button when wired and suppresses it for print', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <LeakPanel overall={null} positions={null} onOpenLeakFinder={onOpen} />
    );
    const button = screen.getByRole('button', { name: 'Open Personal Assistant Leak Finder' });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(<LeakPanel overall={null} positions={null} still onOpenLeakFinder={onOpen} />);
    expect(
      screen.queryByRole('button', { name: 'Open Personal Assistant Leak Finder' })
    ).toBeNull();
  });
});
