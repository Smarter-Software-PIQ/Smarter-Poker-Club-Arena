import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  readDailyChallengesSurface,
  readDailyChallengesUnit,
} from '../helpers/dailyChallengesSources';

const REWARD_PAGES = [
  'src/pages/RakebackPage.tsx',
  'src/pages/AchievementsPage.tsx',
  'src/pages/MarketplacePage.tsx',
];

const PLAY_PAGES = [
  'src/pages/tournament/TournamentLobbyPage.tsx',
  'src/pages/tournament/TournamentResultsPage.tsx',
  'src/pages/SessionHistoryPage.tsx',
];

const UNION_PAGES = [
  'src/pages/CreateUnionPage.tsx',
  'src/pages/UnionDetailPage.tsx',
  'src/pages/UnionGamesPage.tsx',
  'src/pages/UnionStatementsPage.tsx',
  'src/pages/UnionDashboardPage.tsx',
];

describe('cinematic retained route families', () => {
  it.each(REWARD_PAGES)('%s uses the live Rewards Circuit visual anchor', (path) => {
    expect(readFileSync(path, 'utf8')).toContain('RewardsSurfaceHeader');
  });

  it('Promotions wears the arena workspace (#SmarterDesign, Dan 2026-11-27)', () => {
    // Player Offers is a Club Operations page now: the chrome mast and case,
    // never the painted Rewards Circuit console.
    const source = readFileSync('src/pages/PromotionsPage.tsx', 'utf8');
    expect(source).toContain('arena-workspace');
    expect(source).toContain('<ArenaWorkspaceHeader');
    expect(source).not.toContain('RewardsSurfaceHeader');
  });

  it('Transaction History wears the arena workspace (#SmarterDesign, Dan 2026-11-27)', () => {
    // "THE SAME #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE" (Dan, 2026-11-27)
    // supersedes the Rewards Circuit anchor for this page: the chrome mast and
    // the arena case, never the painted console (player pages batch P4).
    const source = readFileSync('src/pages/TransactionHistoryPage.tsx', 'utf8');
    expect(source).toContain('className="transaction-history-page arena-workspace"');
    expect(source).toContain('<ArenaWorkspaceHeader');
    expect(source).not.toContain('RewardsSurfaceHeader');
  });

  it('VIP wears the arena workspace (#SmarterDesign, Dan 2026-11-27)', () => {
    // Player pages batch P6: the chrome mast and arena cases, never the
    // Rewards Circuit page bar.
    const source = readFileSync('src/pages/VIPPage.tsx', 'utf8');
    expect(source).toContain('className="vip-page arena-workspace"');
    expect(source).toContain('<ArenaWorkspaceHeader');
    expect(source).not.toContain('RewardsSurfaceHeader');
  });

  it('Daily Bonus wears the arena workspace (#SmarterDesign, Dan 2026-11-27)', () => {
    // Player pages batch P6: the chrome mast and one arena case around the
    // sheet's glass, never the Rewards Circuit header's painted console.
    const source = readFileSync('src/pages/DailyBonusPage.tsx', 'utf8');
    expect(source).toContain('className="daily-bonus-page arena-workspace"');
    expect(source).toContain('<ArenaWorkspaceHeader');
    expect(source).not.toContain('RewardsSurfaceHeader');
  });

  it('opens the wallet on the routed Cashier desk (Dan 2026-10-16)', () => {
    // "it needs a complete upgrade and enhancement to be like what you created
    // with the pages within this chat": the Cashier's workspace, not the
    // Rewards Circuit console.
    const source = readFileSync('src/pages/PlayerWalletPage.tsx', 'utf8');
    // 2026-10-17: no eyebrow (Dan: "PAGES DON'T NEED TITLES LIKE THIS").
    expect(source).toMatch(/<CashierWorkspace\s+compact\s+title="Wallet"\s+summary="[^"]+"/);
    expect(source).toContain('data-arena-surface="wallet"');
  });

  it('Hand History wears the arena workspace (#SmarterDesign, Dan 2026-11-27)', () => {
    // Dan's order of 2026-11-27 supersedes the Play & Review anchor for the
    // Hand Archive: the chrome mast and the arena case (player pages batch P4).
    // It left the Play Circuit surface, so it no longer carries its marker.
    const source = readFileSync('src/pages/HandHistoryPage.tsx', 'utf8');
    expect(source).toContain('className="hand-history-page arena-workspace"');
    expect(source).toContain('<ArenaWorkspaceHeader');
    expect(source).not.toContain('CasinoSurfaceHeader');
    expect(source).not.toContain('data-arena-surface="play"');
  });

  it.each(PLAY_PAGES)('%s uses the Play & Review visual anchor', (path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('CasinoSurfaceHeader');
    expect(source).toContain('data-arena-surface="play"');
  });

  it('uses a normal leaderboard page after the owner removed its generic frame', () => {
    // Owner direction October 12: remove the generic outer frame.
    const source = readFileSync('src/pages/LeaderboardPage.tsx', 'utf8');
    expect(source).toContain('data-arena-surface="leaderboard-console"');
    expect(source).toContain('ClubPageSection as SpadeConsole');
    expect(source).toContain('titleAs="h1"');
    // Dan 2026-10-17: the "Club Arena" eyebrow went; the "?" sits above the console.
    expect(source).not.toContain('eyebrow="Club Arena"');
    expect(source).toContain('<PageBar');
    expect(source).toContain('titleAs={false}');
    expect(source).not.toContain('className="lb-hero"');
    expect(existsSync('public/assets/club-buttons/console/spade-console-v1/top.png')).toBe(true);
  });

  it('preserves the mission-native Daily Challenges visual authority', () => {
    const source = readFileSync('src/pages/DailyChallengesPage.tsx', 'utf8');
    expect(source).toContain('data-arena-surface="missions"');
    const hero = readDailyChallengesUnit('MissionHero.tsx');
    expect(hero).toContain('className={styles.hero}');
    // Dan 2026-10-17: the hero keeps its live meters on the bevel frame; the
    // eyebrows, the scene art and the description moved behind the "?".
    expect(hero).toContain('<PageBar');
    expect(hero).not.toContain('MissionHeroArtwork');
    const presentation = readDailyChallengesUnit('missionPresentation.ts');
    expect(presentation).not.toContain('Club Arena / Daily Challenge Vault');
    expect(presentation).not.toContain('eyebrow:');
    expect(presentation).not.toContain('daily-missions-casino-v2');
    expect(presentation).toContain("'images/challenges/daily-missions-reward-pedestal-v1.webp'");
    expect(presentation).toContain("'images/challenges/daily-missions-streak-freeze-v1.webp'");
    expect(presentation).toContain("'images/challenges/daily-missions-diamond-96-v1.webp'");
    expect(existsSync('public/images/challenges/daily-missions-reward-pedestal-v1.webp')).toBe(
      true
    );
    expect(existsSync('public/images/challenges/daily-missions-streak-freeze-v1.webp')).toBe(true);
    expect(existsSync('public/images/challenges/daily-missions-diamond-96-v1.webp')).toBe(true);
  });

  it('ships the transparent Daily Missions instrument artwork at its certified dimensions', async () => {
    const diamond = await sharp(
      'public/images/challenges/daily-missions-diamond-96-v1.webp'
    ).metadata();
    const freeze = await sharp(
      'public/images/challenges/daily-missions-streak-freeze-v1.webp'
    ).metadata();

    expect(diamond).toMatchObject({ width: 96, height: 96, hasAlpha: true });
    expect(freeze).toMatchObject({ width: 720, height: 720, hasAlpha: true });
  });

  it.each(UNION_PAGES)('%s opens on the shared page bar, not a hero', (path) => {
    // 2026-10-17, Dan: "PAGES DON'T NEED TITLES LIKE THIS... REMOVE ALL
    // DESCRIPTIONS". The union pages keep their header component, which now
    // prints the page bar and the "?"; the union-bank hero art is gone.
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('CasinoSurfaceHeader');
    expect(source).not.toMatch(/<CasinoSurfaceHeader\b[^>]*?\b(?:eyebrow|artPath)=/);
  });

  it('resolves cinematic artwork through the deploy- and CDN-aware media base', () => {
    // The Rewards header prints on the spade console (#ClubArenaConsole,
    // 2026-09-09) and carries no art of its own, so it left this list. On
    // 2026-10-17 the account, community and workspace heroes left it too:
    // they are page bars now (Dan: "PAGES DON'T NEED TITLES LIKE THIS") and
    // paint no artwork, which the second loop pins.
    // The Daily Challenges artwork prints from its dashboard units.
    const missions = readDailyChallengesSurface();
    expect(missions).toContain('mediaUrl(');
    for (const path of [
      'src/components/account/AccountSurfaceHeader.tsx',
      'src/components/community/CommunitySurfaceHeader.tsx',
      'src/pages/workspaces/ArenaWorkspacePages.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toMatch(/import PageBar from '[./]+(?:components\/)?help\/PageBar';/);
      expect(source, path).not.toContain('mediaUrl(');
    }
    for (const path of [
      'public/assets/club-buttons/wallets/desktop/wallet-diamonds-v1.webp',
      'public/assets/club-buttons/lobby/shark-club-championship-ad-v2.png',
      'public/images/community/community-network-v1.webp',
      'public/images/challenges/daily-missions-reward-pedestal-v1.webp',
      'public/images/challenges/daily-missions-streak-freeze-v1.webp',
      'public/images/challenges/daily-missions-diamond-96-v1.webp',
      'public/images/bg-vault.jpg',
    ]) {
      expect(existsSync(path), `${path} must ship with the build`).toBe(true);
    }
  });

  it('separates tournament results from the fixed tournament-details shell', () => {
    const results = readFileSync('src/pages/tournament/TournamentResultsPage.tsx', 'utf8');
    expect(results).toContain('className="tournament-results-page"');
    expect(results).not.toContain('className="tournament-details"');
  });

  it('renders a union avatar image instead of exposing its URL as text', () => {
    const detail = readFileSync('src/pages/UnionDetailPage.tsx', 'utf8');
    expect(detail).toContain('union.avatarUrl ? <img src={union.avatarUrl}');
    expect(detail).not.toContain('{union.avatarUrl || union.name.charAt(0)}');
  });
});
