import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * THE TOURNAMENT LOBBY'S TAB PANEL KEEPS ITS HEIGHT (2026-11-28)
 *
 * Production post-deploy run 46124486361 failed tournament-watch.spec.ts at
 * "the tab panel must have room to show a tab": at 1280x720 the Tournament
 * Lobby popup's one growing tab panel measured under 200px. Reproduced in a
 * render harness on a mystery bounty event (nine tabs): 203px before #12300,
 * 197px after it, and 140px on a 375x667 phone. The cause was the tab rail:
 * ArenaLobbyConsole.css lays the tabs out as a four-column grid, so nine tabs
 * took three 44px rows (153px) under a ~310px event plaque. The
 * #SmarterDesign skin (TournamentLobbySmarterDesign.css) now keeps every tab
 * on one row that scrolls sideways, which is what the shell
 * (TournamentDetails.css) and the selected-tab scrollIntoView in
 * TournamentDetails.tsx were built for.
 *
 * This loads the real stylesheet stack in the order the lobby gets it, with a
 * header as tall as the measured plaque header, and measures the panel at a
 * phone and at the production verification viewport.
 */
const SHEETS = [
  'src/pages/tournament/TournamentDetails.css',
  'src/components/lobby/ArenaLobbyConsole.css',
  'src/components/lobby/MttConsole.css',
  'src/components/lobby/MttSurfaces.css',
  'src/components/lobby/ArenaWorkspace.css',
  'src/pages/tournament/TournamentLobbySmarterDesign.css',
];

const TABS = [
  'Details',
  'Satellites',
  'Blinds',
  'Ranking',
  'Entries',
  'Unions',
  'Tables',
  'Rewards',
  'Bounties',
];

/** The plaque header measured in the render harness (mystery bounty event). */
const HEADER_PX = 312;

export function registerTournamentLobbyTabPanelHeightCases() {
  for (const [width, height] of [
    [375, 667],
    [393, 852],
    [1280, 720],
  ] as const) {
    test(`the tournament lobby tab panel keeps real height with nine tabs at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const styles = SHEETS.map((p) => readFileSync(p, 'utf8')).join('\n');
      await page.setContent(
        `<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}${styles}</style>
        <div class="tournament-details console-lobby arena-workspace" data-embedded="true" style="--details-h:${height}px">
          <header class="details-header" style="height:${HEADER_PX}px;box-sizing:border-box;flex:none">Event</header>
          <div class="details-tabs" role="tablist">${TABS.map(
            (label, i) =>
              `<button type="button" role="tab" aria-selected="${i === 0}" class="tab ${i === 0 ? 'active' : ''}">${label}</button>`
          ).join('')}</div>
          <div class="details-content" role="tabpanel"><div style="height:900px">Tab</div></div>
          <div class="details-footer"><button class="btn btn-share">Copy Link</button><button class="btn btn-register">Late Register</button></div>
        </div>`
      );

      const geometry = await page.evaluate(() => {
        const strip = document.querySelector('.details-tabs')!;
        const tabs = [...strip.querySelectorAll<HTMLElement>('.tab')];
        return {
          tops: [...new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)))],
          minTabHeight: Math.min(...tabs.map((t) => t.offsetHeight)),
          strip: strip.getBoundingClientRect().height,
          panel: document.querySelector('.details-content')!.getBoundingClientRect().height,
        };
      });
      expect(
        geometry.tops,
        'every tab sits on one row; a grid of rows eats the panel'
      ).toHaveLength(1);
      expect(geometry.minTabHeight, 'each tab keeps the 44px touch floor').toBeGreaterThanOrEqual(
        44
      );
      expect(geometry.strip, 'the tab rail is one row tall').toBeLessThanOrEqual(64);
      expect(
        geometry.panel,
        'the tab panel must have room to show a tab, on a phone as much as anywhere'
      ).toBeGreaterThanOrEqual(200);

      /* Every tab stays reachable: brought into view the way
         TournamentDetails.tsx does it, each one lies whole inside the rail
         and is the thing a tap on it lands on. */
      for (const label of TABS) {
        const reach = await page.getByRole('tab', { name: label, exact: true }).evaluate((tab) => {
          tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const rect = tab.getBoundingClientRect();
          const host = tab.parentElement!.getBoundingClientRect();
          return {
            inside: rect.left >= host.left - 0.5 && rect.right <= host.right + 0.5,
            hittable:
              document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) ===
              tab,
            pageScrollX: window.scrollX,
          };
        });
        expect(reach.inside && reach.hittable, label).toBe(true);
        expect(reach.pageScrollX, 'bringing a tab into view never scrolls the page').toBe(0);
      }
    });
  }
}
