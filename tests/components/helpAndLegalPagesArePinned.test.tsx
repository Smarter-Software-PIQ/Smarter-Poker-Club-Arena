/**
 * THE HELP CENTER AND THE LEGAL DOCUMENTS ARE PINNED BEFORE THEIR FRAMES MOVE
 * (#SmarterDesign player pages batch P2, 2026-11-28)
 *
 * The Help Center (/help) and the four legal documents (/legal/tos,
 * /legal/privacy, /legal/fair-gaming, /legal/promotions) move from their flat
 * sheets to the arena workspace. The words of a legal page are legal text, and
 * the Help Center's answers are what search engines index: no printed word,
 * heading, named region, control or link may change. This renders each page,
 * both as the app draws it and as the prerender writes it for a reader without
 * JavaScript, and pins its headings, full printed text, named regions,
 * controls and every link (text and href).
 *
 * The page header is the one part the pass replaces: the hidden page-bar title
 * becomes the mast's h1, and the "?" moves into the mast. So inside a <header>
 * only the page bar's own live content (the support actions, the breadcrumb)
 * is pinned; the headings list (h1 included) and the single "Page Help"
 * control are pinned across the whole page. The pins were recorded against
 * the old pages on main a3873e77f and are unchanged by the pass.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ user: { id: 'player-1' } }),
}));
vi.mock('../../src/hooks/useSystemHealth', () => ({
  useSystemHealth: () => ({
    health: {
      status: 'ok',
      supabase: 'ok',
      latencyMs: 42,
      timestamp: '2026-08-29T00:00:00.000Z',
      version: 'test',
    },
    isChecking: false,
    retry: () => {},
  }),
}));
vi.mock('../../src/components/common/Toast', () => ({
  useToast: () => ({ success: () => {}, error: () => {} }),
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: () => {} }));

import HelpPage from '../../src/pages/HelpPage';
import TermsOfServicePage from '../../src/pages/legal/TermsOfServicePage';
import PrivacyPolicyPage from '../../src/pages/legal/PrivacyPolicyPage';
import FairGamingPage from '../../src/pages/legal/FairGamingPage';
import ClubPromotionRulesPage from '../../src/pages/legal/PromotionsPage';
import { renderPublicPage } from '../../src/prerender/entry-server';

/** The page with each <header> reduced to its page bar's own live content. */
function body(root: Element): Element {
  const copy = root.cloneNode(true) as Element;
  const headers = [...copy.querySelectorAll('header')].filter(
    (el) => !el.parentElement?.closest('header')
  );
  for (const header of headers) {
    const kept = [...header.querySelectorAll('.ca-page-bar__live > *')].filter(
      (el) => !el.classList.contains('ca-page-bar__status')
    );
    header.replaceWith(...kept);
  }
  return copy;
}

function text(root: Element): string {
  const words: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? '');
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

function headings(root: Element): string[] {
  return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(
    (el) => `${el.tagName.toLowerCase()}|${el.id}|${(el.textContent ?? '').trim()}`
  );
}

/** Every element a test, a screen reader or an e2e spec can name. */
function regions(root: Element): string[] {
  return [
    ...root.querySelectorAll(
      '[aria-label], [aria-labelledby], [role], [aria-live], [aria-current], [id], section, nav, article, aside, footer, main'
    ),
  ].map(
    (el) =>
      `${el.tagName.toLowerCase()}|${el.id}|${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('aria-labelledby') ?? ''}|${el.getAttribute('aria-live') ?? ''}|${el.getAttribute('aria-current') ?? ''}`
  );
}

function controls(root: Element): string[] {
  return [...root.querySelectorAll('button, input, select, textarea')].map((el) => {
    const disabled = (el as HTMLButtonElement).disabled ? ' (disabled)' : '';
    const expanded = el.getAttribute('aria-expanded');
    const name =
      el.getAttribute('aria-label') ??
      el.getAttribute('placeholder') ??
      el.textContent?.trim() ??
      '';
    return `${el.tagName.toLowerCase()}|${el.getAttribute('type') ?? ''}|${name}${expanded ? ` [expanded=${expanded}]` : ''}${disabled}`;
  });
}

function links(root: Element): string[] {
  return [...root.querySelectorAll('a')].map(
    (el) => `${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}|${el.getAttribute('href') ?? ''}`
  );
}

function pin(root: Element) {
  const rest = body(root);
  return {
    headings: headings(root),
    pageHelp: root.querySelectorAll('[aria-label="Page Help"]').length,
    text: text(rest),
    regions: regions(rest),
    controls: controls(rest),
    links: links(rest),
  };
}

function pinFile(name: string) {
  return `./__pins__/${name}.pin.txt`;
}

function renderRoute(node: ReactNode, path: string) {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

function prerendered(path: string): Element {
  const host = document.createElement('div');
  host.innerHTML = renderPublicPage(path).html;
  return host;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const LEGAL: [string, string, ReactNode][] = [
  ['terms-of-service', '/legal/tos', <TermsOfServicePage key="tos" />],
  ['privacy-policy', '/legal/privacy', <PrivacyPolicyPage key="privacy" />],
  ['fair-gaming', '/legal/fair-gaming', <FairGamingPage key="fair" />],
  ['promotion-rules', '/legal/promotions', <ClubPromotionRulesPage key="promotions" />],
];

describe('the legal documents print the same words, headings, regions and links', () => {
  it.each(LEGAL)('%s in the app', async (name, path, page) => {
    const { container } = renderRoute(page, path);
    await expect(JSON.stringify(pin(container), null, 2)).toMatchFileSnapshot(
      pinFile(`legal-${name}`)
    );
  });

  it.each(LEGAL)('%s as prerendered', async (name, path) => {
    await expect(JSON.stringify(pin(prerendered(path)), null, 2)).toMatchFileSnapshot(
      pinFile(`legal-${name}-prerender`)
    );
  });
});

describe('the Help Center prints the same words, headings, regions and links', () => {
  it('loaded, every answer collapsed', async () => {
    const { container } = renderRoute(<HelpPage />, '/help');
    await expect(JSON.stringify(pin(container), null, 2)).toMatchFileSnapshot(
      pinFile('help-loaded')
    );
  });

  it('one answer open', async () => {
    const { container } = renderRoute(<HelpPage />, '/help');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Why Can A Bonus Or Rakeback Rate/i }));
    });
    await expect(JSON.stringify(pin(container), null, 2)).toMatchFileSnapshot(
      pinFile('help-expanded')
    );
  });

  it('a search with no match', async () => {
    const { container } = renderRoute(<HelpPage />, '/help');
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search Help' }), {
        target: { value: 'zzzz no such topic' },
      });
    });
    await expect(JSON.stringify(pin(container), null, 2)).toMatchFileSnapshot(
      pinFile('help-empty')
    );
  });

  it('as prerendered', async () => {
    await expect(JSON.stringify(pin(prerendered('/help')), null, 2)).toMatchFileSnapshot(
      pinFile('help-prerender')
    );
  });
});
