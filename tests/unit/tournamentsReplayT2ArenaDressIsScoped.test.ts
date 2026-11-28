/**
 * Batch T2 (#SmarterDesign, 2026-11-28): XMTTPage, TournamentPage (plus
 * MysteryBountyPanel when opted in with `arena`), and the four share/replay
 * pages (HandReplayerPage, SharedHandReplayPage, ShortHandReplayPage,
 * SharedBonusReplayPage) wear the arena workspace language.
 *
 * Every arena stylesheet scopes all of its selectors under `.arena-workspace`
 * (or `:global(.arena-workspace)` for CSS modules), except the clip-mode frame
 * in SharedHandReplayPage.css which must remain outside `.arena-workspace` for
 * World Hub `/api/cron/render-hand-clips`. None of the arena sheets draws a
 * gradient, radius, shadow, uppercase transform or :hover rule of its own.
 * Shared MysteryBountyPanel opts in only on TournamentPage; BountiesTab keeps
 * the painted SpadeConsole.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '');

const SCOPED_SHEETS: Array<[string, RegExp]> = [
  ['src/pages/XMTTPage.module.css', /^:global\(\.arena-workspace\)\.page\b/],
  ['src/pages/TournamentPageArena.css', /^\.arena-workspace\.tournament-page\b/],
  ['src/components/tournament/MysteryBountyArena.css', /^\.arena-workspace \.mbp--arena\b/],
  ['src/pages/share/HandReplayerPage.css', /^\.arena-workspace\.hand-replayer-workspace\b/],
  ['src/pages/share/SharedBonusReplayPage.css', /^\.arena-workspace\.bonus-replay-workspace\b/],
];

const SHARED_REPLAY_CSS = 'src/pages/share/SharedHandReplayPage.css';

function selectors(sheet: string): string[] {
  return [...sheet.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@'))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

describe('Batch T2 tournaments and share/replay arena dress is scoped', () => {
  it.each(SCOPED_SHEETS)('%s scopes every selector under .arena-workspace', (path, scope) => {
    const found = selectors(css(path));
    expect(found.length).toBeGreaterThan(2);
    for (const selector of found) expect(selector, selector).toMatch(scope);
  });

  it('SharedHandReplayPage.css scopes every viewer rule under .arena-workspace and preserves only clip mode outside it', () => {
    const found = selectors(css(SHARED_REPLAY_CSS));
    expect(found.length).toBeGreaterThan(5);
    for (const selector of found) {
      if (selector.startsWith('.shared-replay--clip')) continue;
      expect(selector, selector).toMatch(/^\.arena-workspace\.shared-replay-workspace\b/);
    }
  });

  it.each([...SCOPED_SHEETS.map(([p]) => p), SHARED_REPLAY_CSS])(
    '%s draws no gradient, radius, shadow, uppercase transform or :hover of its own',
    (path) => {
      const sheet = css(path);
      expect(sheet).not.toMatch(/gradient\(/);
      expect(sheet).not.toMatch(/:hover/);
      expect(sheet).not.toMatch(/border-radius/);
      expect(sheet).not.toMatch(/text-transform:\s*uppercase/);
      expect(
        [...sheet.matchAll(/box-shadow\s*:\s*([^;]+)/g)].every((m) => m[1].trim() === 'none')
      ).toBe(true);
    }
  );

  it('TournamentPage opts MysteryBountyPanel into arena mode while BountiesTab keeps the console', () => {
    const tagOf = (file: string) => {
      const src = read(file);
      const at = src.indexOf('<MysteryBountyPanel');
      expect(at, `${file} must render MysteryBountyPanel`).toBeGreaterThan(-1);
      return src.slice(at, src.indexOf('/>', at));
    };
    expect(tagOf('src/pages/TournamentPage.tsx')).toMatch(/\barena\b/);
    expect(tagOf('src/components/tournament/details/BountiesTab.tsx')).not.toMatch(/\barena\b/);
    expect(css('src/components/tournament/MysteryBountyPanel.module.css')).toMatch(
      /:global\(\.mbp-keys\)\s*\{\s*display:\s*contents;\s*\}/
    );
  });

  it('preserves clip-mode bare frame in SharedHandReplayPage and data hooks in XMTTPage', () => {
    const shared = read('src/pages/share/SharedHandReplayPage.tsx');
    expect(shared).toMatch(
      /if\s*\(clipPayload\)\s*\{\s*return\s*\(\s*<div className="shared-replay shared-replay--clip">\s*<HandReplay source=\{source\} clip=\{clipWindow\} \/>\s*<\/div>\s*\);\s*\}/
    );
    const xmtt = read('src/pages/XMTTPage.tsx');
    expect(xmtt).toContain('data-xmtt-total={lobby.total ?? undefined}');
    expect(xmtt).toContain('data-tournament-id={t.id}');
    expect(xmtt).toContain("lobby.pending ? 'Loading...' : 'Load More'");
  });
});
