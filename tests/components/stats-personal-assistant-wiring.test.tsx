import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LeakPanel from '../../src/components/stats/LeakPanel';
import StatsWorkspacePanel from '../../src/components/stats/StatsWorkspacePanel';
import { HandDetailModal } from '../../src/components/table/HandDetailModal';
import { adaptServiceHandToPanel } from '../../src/lib/handHistoryAdapter';
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

type CssRule = { selectors: string[]; body: string };

/** Comment-free rule list; nested @media bodies are flattened (the first rule
    after an at-rule opener is matched on its own, which is all these checks need). */
const cssRules = (rel: string): CssRule[] => {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) {
    rules.push({
      selectors: match[1].split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
      body: match[2],
    });
  }
  return rules;
};

const rulesTouching = (rules: CssRule[], cls: string): CssRule[] =>
  rules.filter((rule) =>
    rule.selectors.some((selector) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector))
  );

const declared = (rule: CssRule, property: string): string | undefined =>
  new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(rule.body)?.[1].trim();

const remValue = (value: string | undefined): number | null => {
  const m = /^([\d.]+)rem$/.exec(value ?? '');
  return m ? Number(m[1]) : null;
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

  it('keeps every HandHistoryPage control and action on the 44px touch floor', () => {
    const rules = cssRules('src/pages/HandHistoryPage.css');
    const controls = [
      'hh-search__input',
      'hh-search__select',
      'hh-search__date',
      'hh-search__clear',
      'hh-search__export',
      'hh-filter-chip',
      'export-btn',
      'replay-btn',
      'analyze-btn',
      'share-btn',
    ];
    for (const cls of controls) {
      const heights = rulesTouching(rules, cls).map((rule) => declared(rule, 'min-height'));
      expect(heights, `.${cls} declares min-height: 44px`).toContain('44px');
    }
  });

  it('scopes the HandHistoryPage action classes under .hand-history-page so no sheet shares them', () => {
    const rules = cssRules('src/pages/HandHistoryPage.css');
    for (const cls of [
      'export-btn',
      'replay-btn',
      'analyze-btn',
      'share-btn',
      'load-more-btn',
      'hh-filter-chip',
    ]) {
      for (const rule of rulesTouching(rules, cls)) {
        for (const selector of rule.selectors.filter((entry) =>
          new RegExp(`\\.${cls}(?![\\w-])`).test(entry)
        )) {
          expect(selector.replace(/^\[data-theme='light'\] /, ''), `${selector} is scoped`).toMatch(
            /^\.hand-history-page /
          );
        }
      }
    }
    const drilldownFocus = rules
      .flatMap((rule) => rule.selectors)
      .filter((selector) => selector.includes('.hh-stats-drilldown button:focus-visible'));
    expect(drilldownFocus).toEqual(['.hand-history-page .hh-stats-drilldown button:focus-visible']);
  });

  it('gives the HandHistoryPage chips and secondary actions the MTT steel bevel with :active and :focus-visible only', () => {
    const rules = cssRules('src/pages/HandHistoryPage.css');
    for (const cls of ['hh-filter-chip', 'analyze-btn', 'share-btn']) {
      const bevel = rulesTouching(rules, cls).find(
        (rule) => declared(rule, 'border-top-color') === '#aec0d0'
      );
      expect(bevel, `.${cls} steel bevel`).toBeDefined();
      expect(declared(bevel!, 'border')).toBe('1px solid #688299');
      expect(declared(bevel!, 'border-radius')).toBe('6px');
      expect(declared(bevel!, 'background')).toBe(
        'linear-gradient(180deg, #152639 0%, #06111e 65%)'
      );
    }
    const css = read('src/pages/HandHistoryPage.css');
    expect(css).toContain('.hand-history-page .analyze-btn:active');
    expect(css).toContain('.hand-history-page .analyze-btn:focus-visible');
    expect(css).toContain('#56d8ff');
  });

  it('keeps HandHistoryPage labels at 11px or larger on a phone', () => {
    const rules = cssRules('src/pages/HandHistoryPage.css');
    const labels = [
      'stat-label',
      'hh-summary-scope',
      'hand-num',
      'hand-date',
      'hand-footer',
      'hand-tag',
      'pot-label',
      'pot-rake',
    ];
    for (const cls of labels) {
      for (const rule of rulesTouching(rules, cls)) {
        const size = declared(rule, 'font-size');
        if (size) expect(parseFloat(size), `.${cls} ${size}`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it('carries zero :hover selectors in the HandHistoryPage and PlayerStatsPage sheets', () => {
    for (const file of ['src/pages/HandHistoryPage.css', 'src/pages/PlayerStatsPage.css']) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, file).not.toContain(':hover');
    }
  });

  it('paints .stats-hero as machined steel and navy, never a backdrop blur', () => {
    const rules = cssRules('src/pages/PlayerStatsPage.css');
    const hero = rules.filter((rule) => rule.selectors.includes('.stats-hero'));
    expect(hero.length).toBeGreaterThan(0);
    for (const rule of hero) {
      for (const property of ['backdrop-filter', '-webkit-backdrop-filter']) {
        const value = declared(rule, property);
        expect(value === undefined || value.startsWith('none'), `${property} on .stats-hero`).toBe(
          true
        );
      }
    }
    const final = hero.filter((rule) => declared(rule, 'background')?.includes('#0b1826'));
    expect(final.length).toBeGreaterThanOrEqual(2);
    for (const rule of final) {
      expect(declared(rule, 'background')).toBe('linear-gradient(180deg, #0b1826, #040d18)');
      expect(declared(rule, 'border-top-color')).toBe('#aec0d0');
      expect(declared(rule, 'border')).toBe('1px solid #688299');
    }
  });

  it('keeps Stats micro-text at 0.72rem or larger', () => {
    const rules = cssRules('src/pages/PlayerStatsPage.css');
    for (const cls of [
      'hero-stat-sub',
      'gauge-label',
      'stats-brief-label',
      'stats-last-updated',
      'stats-evidence-unavailable',
    ]) {
      for (const rule of rulesTouching(rules, cls)) {
        const size = remValue(declared(rule, 'font-size'));
        if (size !== null) expect(size, `.${cls}`).toBeGreaterThanOrEqual(0.72);
      }
    }
    for (const rule of rules.filter((r) => r.selectors.includes('.stats-club-table thead th'))) {
      const size = remValue(declared(rule, 'font-size'));
      if (size !== null) expect(size).toBeGreaterThanOrEqual(0.72);
    }
  });

  it('scopes the Stats page classes that other sheets also define under .stats-page', () => {
    const rules = cssRules('src/pages/PlayerStatsPage.css');
    for (const cls of [
      'export-btn',
      'chart-card',
      'bench-pill',
      'bench-bar-scale',
      'bench-note',
      'heatmap-select',
      'heatmap-scroll',
      'heatmap-cell',
      'nemesis-expand',
      'pos-radar-axis-label',
      'pos-radar-toggle',
      'sharecard',
      'trophy-note',
    ]) {
      for (const rule of rulesTouching(rules, cls)) {
        for (const selector of rule.selectors.filter((entry) =>
          new RegExp(`\\.${cls}(?![\\w-])`).test(entry)
        )) {
          expect(selector, `${selector} is scoped`).toMatch(/^\.stats-page /);
        }
      }
    }
  });

  it('gives Stats tabs and range chips :active press feedback without hover', () => {
    const css = read('src/pages/PlayerStatsPage.css');
    expect(css).toContain('.stats-page .stats-pill-tabs button:active');
    expect(css).toContain('.stats-page .stats-range-row button:active');
  });

  it('renders the Cash / Tournaments switch inside .stats-page with the MTT steel frame', () => {
    const header = read('src/pages/stats/StatsWorkspaceHeader.tsx');
    expect(header).toContain('<StatsGameModeControl />');

    // Every place the page mounts the header sits inside the stats-page shell.
    const page = read('src/pages/PlayerStatsPage.tsx');
    const mounts = [...page.matchAll(/<StatsWorkspaceHeader|\{mast\}/g)]
      .map((m) => m.index!)
      // `const mast = <StatsWorkspaceHeader .../>` only defines the element.
      .filter((index) => !/const mast = $/.test(page.slice(0, index)));
    expect(mounts.length).toBeGreaterThanOrEqual(5);
    for (const index of mounts) {
      const before = page.slice(0, index);
      const shell = before.lastIndexOf('className="stats-page arena-workspace');
      const shellAlt = before.lastIndexOf('className={`stats-page arena-workspace');
      const open = Math.max(shell, shellAlt);
      expect(open, 'a stats-page shell opens before the header').toBeGreaterThan(-1);
      // Opened by the nearest return, not left over from an earlier early return.
      expect(before.slice(open)).not.toMatch(/\n {4}\);\n {2}\}/);
    }

    const rules = cssRules('src/pages/PlayerStatsPage.css');
    const frame = rules.find((rule) =>
      rule.selectors.includes('.stats-page.arena-workspace .arena-switch')
    );
    expect(frame).toBeDefined();
    expect(declared(frame!, 'border')).toBe('1px solid #688299');
    expect(declared(frame!, 'border-top-color')).toBe('#aec0d0');
    expect(declared(frame!, 'border-radius')).toBe('6px');
    const buttons = rules.find((rule) =>
      rule.selectors.includes('.stats-page.arena-workspace .arena-switch > button')
    );
    expect(declared(buttons!, 'min-height')).toBe('44px');
  });

  it('HandDetailModal renders a #SmarterDesign Analyze button when onAnalyze is supplied and invokes it with the active hand', () => {
    const sampleHand = adaptServiceHandToPanel(
      {
        id: '11111111-2222-4333-8444-555555555555',
        serial_number: '991001',
        table_id: 'table-1',
        table_name: 'Foundry 1/2',
        played_at: '2026-11-26T12:00:00.000Z',
        hand_number: 991001,
        total_hands: 0,
        main_pot: 24,
        side_pots: [],
        community_cards: ['Ah', 'Kd', '7c', '2s', '9h'],
        players: [
          {
            seat: 1,
            user_id: 'hero-1',
            username: 'Hero',
            avatar_url: null,
            position: 'BTN',
            hole_cards: [
              { rank: 'A', suit: 'spades' },
              { rank: 'Q', suit: 'spades' },
            ],
            result: 12,
            is_winner: true,
            showdown_reveal: { reveal_order: 1, mucked: false, hand_name: 'Pair' },
          },
          {
            seat: 2,
            user_id: 'villain-1',
            username: 'Villain',
            avatar_url: null,
            position: 'BB',
            hole_cards: [
              { rank: 'K', suit: 'hearts' },
              { rank: 'J', suit: 'hearts' },
            ],
            result: -12,
            is_winner: false,
            showdown_reveal: { reveal_order: 2, mucked: false, hand_name: 'Pair' },
          },
        ],
        actions: [
          { player_id: 'hero-1', action: 'raise', amount: 6, street: 'preflop', timestamp: 1 },
          { player_id: 'villain-1', action: 'call', amount: 4, street: 'preflop', timestamp: 2 },
        ],
        winners: [{ user_id: 'hero-1', amount: 24, pot_index: 0, hand_name: 'Pair' }],
        winners_by_board: [],
        rake: 0,
        bbj_fee: 0,
        game_type: 'NLH',
        stakes: '1/2',
      } as unknown as Parameters<typeof adaptServiceHandToPanel>[0],
      'hero-1'
    );

    const onAnalyze = vi.fn();
    const { rerender, unmount } = render(
      <HandDetailModal
        isOpen
        onClose={vi.fn()}
        hands={[sampleHand]}
        heroId="hero-1"
        onShare={vi.fn()}
        onReplay={vi.fn()}
        onAnalyze={onAnalyze}
      />
    );
    const analyzeBtn = screen.getByRole('button', {
      name: 'Analyze Hand In Personal Assistant Leak Finder',
    });
    expect(analyzeBtn.textContent).toBe('Analyze');
    fireEvent.click(analyzeBtn);
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    expect(onAnalyze).toHaveBeenCalledWith(sampleHand);

    rerender(
      <HandDetailModal
        isOpen
        onClose={vi.fn()}
        hands={[sampleHand]}
        heroId="hero-1"
        onShare={vi.fn()}
        onReplay={vi.fn()}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Analyze Hand In Personal Assistant Leak Finder' })
    ).toBeNull();
    unmount();

    const historySource = read('src/pages/HandHistoryPage.tsx');
    expect(historySource).toContain('onAnalyze={(hand) => analyzeInPersonalAssistant(hand)}');

    const modalCss = read('src/components/table/HandDetailModal.css').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );
    expect(modalCss).not.toContain(':hover');
    expect(modalCss).toContain('button.hdm-actions__analyze');
    expect(modalCss).toContain('button.hdm-actions__analyze:active');
    expect(modalCss).toContain('button.hdm-actions__analyze:focus-visible');
    const modalRules = cssRules('src/components/table/HandDetailModal.css');
    const analyzeRule = rulesTouching(modalRules, 'hdm-actions__analyze').find(
      (rule) => declared(rule, 'min-height') === '44px'
    );
    expect(analyzeRule).toBeDefined();
    expect(declared(analyzeRule!, 'border')).toContain('#56d8ff');
  });

  it('HandHistoryPage returnToPersonalAssistant preserves format, uses same-tab return when unseated, keeps custom seated toast, and handles popup blocks safely', () => {
    const source = read('src/pages/HandHistoryPage.tsx');
    expect(source).toContain("params.set('format', formatParam);");
    expect(source).toContain('window.location.assign(url)');
    expect(source).toContain('{ sameTab: true }');
    expect(source).toContain('if (opened === null)');
    expect(source).toContain('Opened In Current Tab');
    expect(source).toContain("toastMessage.includes('Live Detection Locked While Seated')");
    // Never leak hole cards or opponent names in Personal Assistant query URLs
    expect(source).not.toMatch(
      /\/hub\/personal-assistant\/leaks[^`'"\n]*(hole|cards|villain|opponent)/i
    );
  });

  it('PlayerStatsPage openLeakFinder catches errors, provides toast feedback when unseated, and handles popup blocks cleanly', () => {
    const pageSource = read('src/pages/PlayerStatsPage.tsx');
    expect(pageSource).toContain("reportError(error, 'PlayerStatsPage.open_leak_finder_failed')");
    expect(pageSource).toContain("toast.error('Could Not Open Personal Assistant Leak Finder')");
    expect(pageSource).toContain("toast.info('Opening Personal Assistant Leak Finder')");
    expect(pageSource).toContain(
      "toast.info('Opening Personal Assistant Leak Finder (Opened In Current Tab)')"
    );
    expect(pageSource).toContain('window.location.assign(url)');
  });

  it('allows .tournament-study-actions buttons to wrap cleanly on narrow phones without :hover', () => {
    for (const file of ['src/pages/PlayerStatsPage.css', 'src/pages/stats/StatsWorkbench.css']) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, file).not.toContain(':hover');
      const rules = cssRules(file);
      const wrapRule = rulesTouching(rules, 'tournament-study-actions').find(
        (rule) =>
          rule.selectors.some((selector) => selector.includes('button')) &&
          declared(rule, 'white-space') === 'normal'
      );
      expect(wrapRule, `${file} wraps .tournament-study-actions button`).toBeDefined();
      expect(declared(wrapRule!, 'line-height')).toBe('1.25');
      expect(declared(wrapRule!, 'text-align')).toBe('center');
    }
    const workbenchCss = read('src/pages/stats/StatsWorkbench.css');
    expect(workbenchCss).toContain('.stats-page .tournament-study-actions button:active');
    expect(workbenchCss).toContain('.stats-page .tournament-study-actions button:focus-visible');
  });

  it('gives .stats-workspace__word-action 44px touch height, pointer cursor, :active, and :focus-visible without :hover', () => {
    const css = read('src/components/stats/StatsWorkspacePanel.css').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );
    expect(css).not.toContain(':hover');
    expect(css).toContain('.stats-workspace__word-action:active');
    expect(css).toContain('.stats-workspace__word-action:focus-visible');
    const rules = cssRules('src/components/stats/StatsWorkspacePanel.css');
    const base = rules.find((rule) => rule.selectors.includes('.stats-workspace__word-action'));
    expect(base).toBeDefined();
    expect(declared(base!, 'min-height')).toBe('44px');
    expect(declared(base!, 'cursor')).toBe('pointer');
  });
});
