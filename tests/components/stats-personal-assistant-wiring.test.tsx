import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LeakPanel from '../../src/components/stats/LeakPanel';
import StatsWorkspacePanel from '../../src/components/stats/StatsWorkspacePanel';
import { hubTabTitle } from '../../src/utils/hubTab';
import type { StatsWorkspaceSnapshot } from '../../src/services/StatsWorkspaceService';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const EMPTY_WORKSPACE: StatsWorkspaceSnapshot = {
  preferences: {
    dashboardLayout: ['overview', 'performance', 'hands'],
    privacyPresentationMode: false,
  },
  reports: [],
  leaks: [],
  goals: [],
  progress: [],
  collections: [],
  alerts: [],
  coverage: { capped: false, rowLimit: 50 },
};

describe('Club Arena <-> Personal Assistant Leak Finder wiring & anti-regression fortress', () => {
  it('HandHistoryPage routes hand analysis to /hub/personal-assistant/leaks by hand ID with zero retired Jarvis identifiers/URLs', () => {
    const source = read('src/pages/HandHistoryPage.tsx');
    expect(source).toContain(
      '/hub/personal-assistant/leaks?source=club-arena&hand=${encodeURIComponent(hand.id)}'
    );
    expect(source).not.toContain('/hub/jarvis');
    expect(source).not.toContain('Send It To Jarvis');
    expect(source).not.toContain('analyzeWithJarvis');
    expect(source).not.toContain('Failed_to_send_hand_to_Jarvis');
    expect(source).toContain('analyzeInPersonalAssistant');
    expect(source).toContain(
      "masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: userId ?? undefined });"
    );
    expect(source).toContain("openInBrowser(`${WEB_ORIGIN}${path}`, 'noopener,noreferrer')");
    expect(source).toContain('Opening Leak Finder (Solver Audit Covers Holdem Hands)');
  });

  it('HandHistoryPage distinguishes linked hand network errors from missing/foreign hands and offers Personal Assistant return navigation', () => {
    const source = read('src/pages/HandHistoryPage.tsx');
    expect(source).toContain("useState<'idle' | 'loading' | 'missing' | 'error'>('idle')");
    expect(source).toContain("setLinkedState('error')");
    expect(source).toContain('Retry Linked Hand');
    expect(source).toContain("searchParams.get('source') === 'personal-assistant'");
    expect(source).toContain("searchParams.get('source') === 'personal-assistant-loop'");
    expect(source).toContain('Return To Personal Assistant');
    expect(source).toContain('returnLeakId');
  });

  it('pageTutorials uses Personal Assistant copy instead of retired Jarvis', () => {
    const tutorials = read('src/components/help/pageTutorials.ts');
    expect(tutorials).not.toContain('Send It To Jarvis');
    expect(tutorials).toContain('Open It In Personal Assistant');
  });

  it('PlayerStatsPage, AnalysisTab, and WorkspaceTab wire Personal Assistant Leak Finder via hub tab during live play or browser otherwise (own profile only)', () => {
    const pageSource = read('src/pages/PlayerStatsPage.tsx');
    const tabSource = read('src/pages/stats/AnalysisTab.tsx');
    const workspaceSource = read('src/pages/stats/WorkspaceTab.tsx');
    expect(pageSource).toContain('/hub/personal-assistant/leaks?source=club-arena-stats');
    expect(pageSource).toContain(
      "masterBus.emit('OPEN_HUB_TAB', { path, requestedBy: user?.id ?? targetUserId });"
    );
    expect(pageSource).toContain('Opening Leak Finder (Live Detection Locked While Seated)');
    expect(pageSource).toContain('onOpenLeakFinder={isOwnProfile ? openLeakFinder : undefined}');
    expect(pageSource).toContain('onOpenLeakFinder={openLeakFinder}');
    expect(tabSource).toContain('onOpenLeakFinder={onOpenLeakFinder}');
    expect(workspaceSource).toContain('onOpenLeakFinder={onOpenLeakFinder}');

    const leakPanelCss = read('src/components/stats/LeakPanel.css');
    const handHistoryCss = read('src/pages/HandHistoryPage.css');
    expect(leakPanelCss).toContain('min-height: 44px;');
    expect(leakPanelCss).toContain('#688299');
    expect(handHistoryCss).toContain('min-height: 44px;');
    expect(handHistoryCss).toContain('font-size: 12px;');
    expect(handHistoryCss).toContain('flex-wrap: wrap;');
    expect(pageSource).toContain('[user?.id, targetUserId, gameMode, toast]');
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

  it('StatsWorkspacePanel renders the Personal Assistant Leak Finder CTA for the profile owner and hides it for non-owners', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <StatsWorkspacePanel
        isOwnProfile
        workspace={EMPTY_WORKSPACE}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenLeakFinder={onOpen}
      />
    );
    const button = screen.getByRole('button', { name: 'Open Personal Assistant Leak Finder' });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(
      <StatsWorkspacePanel
        isOwnProfile={false}
        workspace={EMPTY_WORKSPACE}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenLeakFinder={onOpen}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Open Personal Assistant Leak Finder' })
    ).toBeNull();
  });
});
