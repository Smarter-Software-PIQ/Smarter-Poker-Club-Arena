import { expect, type Page } from '@playwright/test';
import { readMobileTableLayout } from './mobileLiveTableLayout';

/**
 * EVERY TOP CHAIR STANDS ON THE RAIL (Dan 2026-11-22), on the real seat
 * components: every ring that has its own top chairs, at the 600px phone layout and a portrait tablet, cash and tournament, seated
 * and watched, with the jackpot plaque drawn. The six- and nine-seat phone
 * rings are proved by the fixed-artwork cases (mobileAvatarSizingCases.ts),
 * which assert the same "Top Seat" violations alongside the approved sizes.
 *
 * tests/every-top-chair-stands-on-the-rail.law.test.tsx carries the arithmetic.
 */
export const TOP_CHAIR_RAIL_CASES = [
  // The 600px phone layout (390x844 and its kin), every ring with a top chair.
  { width: 600, height: 1298, seats: '2', spectator: 'false', tournament: 'false' },
  { width: 600, height: 1298, seats: '3', spectator: 'true', tournament: 'false' },
  { width: 600, height: 1298, seats: '4', spectator: 'true', tournament: 'true' },
  { width: 600, height: 1298, seats: '5', spectator: 'false', tournament: 'true' },
  { width: 600, height: 1298, seats: '7', spectator: 'false', tournament: 'false' },
  { width: 600, height: 1298, seats: '8', spectator: 'true', tournament: 'false' },
  { width: 600, height: 1298, seats: '10', spectator: 'true', tournament: 'true' },
  // The shortest phone layout (320x568, 375x667).
  { width: 600, height: 1065, seats: '2', spectator: 'true', tournament: 'false' },
  { width: 600, height: 1065, seats: '8', spectator: 'false', tournament: 'true' },
  // Portrait tablets.
  { width: 768, height: 1024, seats: '4', spectator: 'false', tournament: 'false' },
  { width: 768, height: 1024, seats: '6', spectator: 'true', tournament: 'false' },
  { width: 768, height: 1024, seats: '9', spectator: 'true', tournament: 'true' },
  { width: 700, height: 1000, seats: '8', spectator: 'true', tournament: 'false' },
] as const;

export type TopChairRailSettings = (typeof TOP_CHAIR_RAIL_CASES)[number];

const topSeatViolations = (page: Page) =>
  page
    .evaluate(readMobileTableLayout, {})
    .then((result) => result.violations.filter((v: string) => /Top Seat|Tab Bar/.test(v)));

/** Runs inside the observer harness (real components, production CSS and the
 * Inter face). The bundle mounts after the dataset is set. */
export async function checkTopChairsOnTheRail(
  page: Page,
  bundle: string,
  settings: TopChairRailSettings
) {
  await page.setViewportSize({ width: settings.width, height: settings.height });
  await page.reload();
  const notched = settings.height >= 844;
  await page.evaluate(
    ({ settings, notched }) => {
      for (const style of document.querySelectorAll('style'))
        style.textContent = (style.textContent || '')
          .replace(/env\(\s*safe-area-inset-top\s*(?:,[^()]*)?\)/g, notched ? '47px' : '0px')
          .replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^()]*)?\)/g, notched ? '34px' : '0px');
      Object.assign(document.documentElement.dataset, {
        seats: settings.seats,
        spectator: settings.spectator,
        tournament: settings.tournament,
        cards: '2',
        villainCards: '2',
        jackpot: 'mini',
        revealed: 'false',
        showAll: 'false',
        dealer: '1',
        activeSeat: '-1',
        action: 'preflop',
        actionPills: 'none',
        actionCaption: '',
        waitlist: 'true',
        folded: '',
        occupiedSeats: '',
        avatarMix: 'true',
      });
    },
    { settings, notched }
  );
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')).length > 0 &&
      Array.from(document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')).every(
        (i) => i.complete && i.naturalWidth > 0
      )
  );
  await page.evaluate(() => document.fonts.ready);
  const settle = async () => {
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        for (const animation of document.getAnimations()) {
          if (Number.isFinite(animation.effect?.getComputedTiming().iterations)) {
            try {
              animation.finish();
            } catch {
              /* An unattached effect has no finish. */
            }
          }
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }
    });
    let previous = '',
      stable = 0;
    await expect
      .poll(
        async () => {
          const signature = await page.evaluate(() =>
            JSON.stringify(
              Array.from(document.querySelectorAll('.seat-wrapper,.seat__info,.seat__card')).map(
                (e) => {
                  const r = e.getBoundingClientRect();
                  return [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 100));
                }
              )
            )
          );
          stable = signature === previous ? stable + 1 : 0;
          previous = signature;
          return stable;
        },
        { timeout: 10000, intervals: [100] }
      )
      .toBeGreaterThanOrEqual(5);
  };
  /** The top chairs' plates and portraits, as drawn. */
  const topChairs = () =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.seat-wrapper--cap:not(.seat-wrapper--hero),.seat-wrapper--top:not(.seat-wrapper--hero)'
        )
      ).map((wrapper) => {
        const rect = (selector: string) => {
          const r = wrapper.querySelector(selector)?.getBoundingClientRect();
          return r
            ? [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 100) / 100)
            : null;
        };
        return { plate: rect('.seat__info'), portrait: rect('.seat__avatar-img') };
      })
    );
  /** Every card a top chair shows (its face-down fan or a tabled hand) that
   * is behind the tab bar or off the screen. */
  const cardsBehindTheBar = () =>
    page.evaluate(() => {
      const bar = document
        .querySelector('.multi-table-page__tab-bar-wrapper')
        ?.getBoundingClientRect().bottom;
      return Array.from(
        document.querySelectorAll(
          ':is(.seat-wrapper--cap,.seat-wrapper--top):not(.seat-wrapper--hero) .seat__cards .seat__card'
        )
      )
        .map((card) => card.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .filter(
          (r) =>
            r.top < (bar ?? 0) - 0.5 ||
            r.left < -0.5 ||
            r.right > innerWidth + 0.5 ||
            r.bottom > innerHeight + 0.5
        )
        .map((r) => JSON.stringify(r.toJSON()));
    });
  await settle();
  const resting = await topChairs();
  expect(resting.length, 'the ring has top chairs').toBeGreaterThan(0);
  expect(
    await topSeatViolations(page),
    `${settings.seats} seats at ${settings.width}x${settings.height}: every top chair stands on the rail`
  ).toEqual([]);
  expect(await cardsBehindTheBar(), 'a top chair keeps its cards in front of the tab bar').toEqual(
    []
  );
  // An action caption arriving after placement never moves a top chair.
  for (const caption of ['check', 'fold', 'raise']) {
    await page.evaluate((caption) => {
      document.documentElement.dataset.actionPills = 'true';
      document.documentElement.dataset.actionCaption = caption;
      document.documentElement.dataset.bets = '';
      document.dispatchEvent(new Event('fixture-runout'));
    }, caption);
    await settle();
    expect(await topChairs(), `${caption} cannot move a top chair`).toEqual(resting);
    expect(await topSeatViolations(page), `${caption}: still on the rail`).toEqual([]);
  }
  // A showdown with every hand tabled, then the next hand: still on the rail,
  // and every shown card of a top chair is whole and in front of the tab bar.
  await page.evaluate(() => {
    Object.assign(document.documentElement.dataset, {
      revealed: 'true',
      showAll: 'true',
      actionCaption: '',
      actionPills: 'true',
    });
    document.dispatchEvent(new Event('fixture-next-hand'));
  });
  await settle();
  expect(await topSeatViolations(page), 'showdown: still on the rail').toEqual([]);
  expect(await cardsBehindTheBar(), 'a top chair tables its hand in front of the tab bar').toEqual(
    []
  );
  expect(
    (await topChairs()).map((chair) => chair.plate),
    'a tabled hand never moves a top plate'
  ).toEqual(resting.map((chair) => chair.plate));
}
