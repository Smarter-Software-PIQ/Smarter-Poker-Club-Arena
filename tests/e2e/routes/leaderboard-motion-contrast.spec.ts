import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  leaderboardMotionSnapshot,
  waitForLeaderboardEntryMotion,
} from '../support/leaderboardMotion';

test('leaderboard contrast certification waits for actual entrance motion and retains contrast refusal', async ({
  page,
}) => {
  const css =
    readFileSync('src/pages/LeaderboardPage.css', 'utf8') +
    readFileSync('src/styles/animations.css', 'utf8');
  await page.setContent(
    `<style>body{background:#000}${css}</style><main class="leaderboard-page"><div class="club-page-body"><div class="podium-section" style="opacity:0;animation:animationsFadeInUp 0.7s ease-out forwards">${[1, 2, 3].map((i) => `<div class="podium-place"><div class="entry-info"><span class="entry-name">Player ${i}</span><span class="entry-vip-tag">VIP</span><div class="entry-subline">13.7K Hands</div></div></div>`).join('')}</div></div></main>`
  );
  await page.evaluate(() => {
    const motion = document.querySelector('.podium-section')!.getAnimations()[0];
    motion.pause();
    motion.currentTime = 120;
  });
  const contrastNodes = async () =>
    (await new AxeBuilder({ page }).include('main').analyze()).violations
      .filter((v) => v.id === 'color-contrast')
      .flatMap((v) => v.nodes);
  expect(await contrastNodes()).toHaveLength(9);
  // A reading taken now overlaps motion, and the board says so.
  expect(await leaderboardMotionSnapshot(page, 'main')).toEqual({ entries: 1, moving: 1 });
  await page.evaluate(() => document.querySelector('.podium-section')!.getAnimations()[0].play());
  await waitForLeaderboardEntryMotion(page, 'main', 'Original Entrance');
  expect(await leaderboardMotionSnapshot(page, 'main')).toEqual({ entries: 1, moving: 0 });
  expect(await contrastNodes()).toHaveLength(0);
  // The motion wait must not turn a genuinely unreadable settled palette green.
  await page.addStyleTag({ content: '.leaderboard-page .entry-name{color:#333}' });
  await waitForLeaderboardEntryMotion(page, 'main', 'Unreadable Settled Palette');
  expect(await contrastNodes()).toHaveLength(3);
});

test('tournament stats entrance motion is awaited before contrast certification and retains contrast refusal', async ({
  page,
}) => {
  const css =
    readFileSync('src/pages/LeaderboardPage.css', 'utf8') +
    readFileSync('src/styles/animations.css', 'utf8');
  await page.setContent(
    `<style>body{background:#000}${css}</style><main class="leaderboard-page"><div class="club-page-body"><div class="tournament-stats-scroll">${[1, 2, 3].map((i) => `<div class="tournament-stats-entry animate-fade-in-up stagger-${i}" style="opacity:0;animation:animationsFadeInUp 0.7s ease-out forwards"><div class="stats-cell player-cell"><span class="rank-badge">#${i}</span><span class="player-name">Player ${i}</span></div><div class="stats-cell prizes" data-label="Total Prizes">1,250</div></div>`).join('')}</div></div></main>`
  );
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.tournament-stats-entry')) {
      const motion = el.getAnimations()[0];
      motion.pause();
      motion.currentTime = 120;
    }
  });
  const contrastNodes = async () =>
    (await new AxeBuilder({ page }).include('main').analyze()).violations
      .filter((v) => v.id === 'color-contrast')
      .flatMap((v) => v.nodes);
  expect((await contrastNodes()).length).toBeGreaterThan(0);
  expect(await leaderboardMotionSnapshot(page, 'main')).toEqual({ entries: 3, moving: 3 });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.tournament-stats-entry')) {
      el.getAnimations()[0].play();
    }
  });
  await waitForLeaderboardEntryMotion(page, 'main', 'Tournament Stats Entrance');
  expect(await leaderboardMotionSnapshot(page, 'main')).toEqual({ entries: 3, moving: 0 });
  expect(await contrastNodes()).toHaveLength(0);
  await page.addStyleTag({ content: '.leaderboard-page .player-name{color:#333}' });
  await waitForLeaderboardEntryMotion(page, 'main', 'Tournament Stats Unreadable Palette');
  expect(await contrastNodes()).toHaveLength(3);
});
