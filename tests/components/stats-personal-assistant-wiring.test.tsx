import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LeakPanel from '../../src/components/stats/LeakPanel';
import { hubTabTitle } from '../../src/utils/hubTab';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Club Arena <-> Personal Assistant Leak Finder wiring', () => {
  it('HandHistoryPage routes hand analysis to /hub/personal-assistant/leaks by hand ID (never 404 /hub/jarvis)', () => {
    const source = read('src/pages/HandHistoryPage.tsx');
    expect(source).toContain(
      '/hub/personal-assistant/leaks?source=club-arena&hand=${encodeURIComponent(hand.id)}'
    );
    expect(source).not.toContain('/hub/jarvis');
    expect(source).not.toContain('Send It To Jarvis');
    expect(source).toContain(
      "masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: userId ?? undefined });"
    );
    expect(source).toContain("openInBrowser(`${WEB_ORIGIN}${path}`, 'noopener,noreferrer')");
  });

  it('pageTutorials uses Personal Assistant copy instead of retired Jarvis', () => {
    const tutorials = read('src/components/help/pageTutorials.ts');
    expect(tutorials).not.toContain('Send It To Jarvis');
    expect(tutorials).toContain('Open It In Personal Assistant');
  });

  it('PlayerStatsPage and AnalysisTab wire Personal Assistant Leak Finder via hub tab during live play or browser otherwise (own profile only)', () => {
    const pageSource = read('src/pages/PlayerStatsPage.tsx');
    const tabSource = read('src/pages/stats/AnalysisTab.tsx');
    expect(pageSource).toContain('/hub/personal-assistant/leaks?source=club-arena-stats');
    expect(pageSource).toContain(
      "masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: user?.id ?? targetUserId });"
    );
    expect(pageSource).toContain('onOpenLeakFinder={isOwnProfile ? openLeakFinder : undefined}');
    expect(tabSource).toContain('onOpenLeakFinder={onOpenLeakFinder}');
  });

  it('MultiTablePage OPEN_HUB_TAB guards native Capacitor builds and updates existing tab URLs for new hands', () => {
    const multi = read('src/pages/MultiTablePage.tsx');
    const frame = read('src/components/table/HubFrame.tsx');
    expect(multi).toContain(
      "if (isNativePlatform()) {\n      openInBrowser(new URL(path, WEB_ORIGIN).href, 'noopener,noreferrer');"
    );
    expect(multi).toContain('prev[existing].hubUrl !== path');
    expect(frame).toContain('if (src === lastPropSrcRef.current) return;');
    expect(hubTabTitle('/hub/personal-assistant/leaks')).toBe('Assistant');
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
