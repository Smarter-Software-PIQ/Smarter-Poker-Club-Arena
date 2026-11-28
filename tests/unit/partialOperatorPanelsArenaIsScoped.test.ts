/**
 * The last painted panels on three converted pages wear #SmarterDesign
 * (2026-11-28): the jackpot Announcements on Club Settings, the promotion
 * standings on Player Offers and the Performance Score on the Agent
 * Dashboard. Each panel is hosted by exactly one page, and that page's root is
 * an arena workspace; the dress applies only inside .arena-workspace, and no
 * sheet draws a gradient, radius, shadow, hover or uppercase of its own.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '');

/* [sheet, scope every selector must open with, the arena section of a sheet
   that also carries the panel's older rules] */
const SHEETS: Array<[string, RegExp, string | null]> = [
  ['src/components/bbj/BBJThresholdArena.css', /^\.arena-workspace\s/, null],
  [
    'src/components/leaderboard/LeaderboardCard.module.css',
    /^:global\(\.arena-workspace\)\s/,
    '#SmarterDesign (2026-11-28)',
  ],
  ['src/components/agent/AgentScoreCardArena.css', /^\.arena-workspace\s/, null],
];

/* [component, its one host page, the host's arena root] */
const HOSTS: Array<[string, string, string]> = [
  [
    'src/components/bbj/BBJThresholdPanel',
    'src/pages/ClubSettingsPage.tsx',
    'club-settings-page arena-workspace',
  ],
  [
    'src/components/leaderboard/LeaderboardCard',
    'src/pages/PromotionsPage.tsx',
    'promotions-page arena-workspace',
  ],
  ['src/components/agent/AgentScoreCard', 'src/pages/AgentDashboardPage.tsx', 'arena-workspace'],
];

function selectors(sheet: string): string[] {
  return [...sheet.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@'))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

/* A sheet that also carries a panel's older rules is read from its arena
   marker on. */
function arenaPart(path: string, marker: string | null): string {
  const raw = read(path);
  if (marker === null) return css(path);
  const at = raw.indexOf(marker);
  expect(at, `${path} lost its marker`).toBeGreaterThan(0);
  return raw.slice(raw.lastIndexOf('/*', at)).replace(/\/\*[\s\S]*?\*\//g, '');
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
const SOURCES = sources('src');

describe('the partial operator panels arena dress', () => {
  it.each(SHEETS)('%s scopes every selector', (path, scope, marker) => {
    const found = selectors(arenaPart(path, marker));
    expect(found.length).toBeGreaterThan(5);
    for (const selector of found) expect(selector, selector).toMatch(scope);
  });

  it.each(SHEETS)(
    '%s draws no gradient, radius, shadow, hover or uppercase of its own',
    (path, _scope, marker) => {
      const sheet = arenaPart(path, marker);
      expect(sheet).not.toMatch(/gradient\(/);
      expect(sheet).not.toMatch(/:hover/);
      expect(
        [...sheet.matchAll(/border-radius\s*:\s*([^;]+)/g)].every((m) => m[1].trim() === '0')
      ).toBe(true);
      expect(sheet).not.toMatch(/text-transform:\s*uppercase/);
      expect(
        [...sheet.matchAll(/box-shadow\s*:\s*([^;]+)/g)].every((m) => m[1].trim() === 'none')
      ).toBe(true);
    }
  );

  it.each(HOSTS)('%s is hosted only by %s, an arena workspace page', (component, host, root) => {
    const name = component.split('/').pop() as string;
    const importers = SOURCES.filter(
      (file) => !file.startsWith(component) && new RegExp(`/${name}['"]`).test(read(file))
    );
    expect(importers).toEqual([host]);
    expect(read(host)).toContain(root);
  });

  it.each(HOSTS)('%s carries no painted console section', (component) => {
    const source = read(`${component}.tsx`);
    expect(source).not.toMatch(
      /import \{[^}]*\bSpadeConsole\b[^}]*\} from '\.\.\/console\/SpadeConsole'/
    );
    expect(source).toMatch(/ClubPageSection as SpadeConsole|className=\{?["'`][^"'`]*arena/);
  });
});
