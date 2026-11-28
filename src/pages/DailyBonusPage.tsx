/**
 * /bonuses - the Daily Club Arena Bonus, as a page.
 *
 * The same sheet the shell raises on entry, rendered inline for the nav link,
 * the wallet door, the profile's Bonus Center and any old bookmark.
 *
 * #SmarterDesign (player pages batch P6, 2026-11-28): Dan's order "THE SAME
 * #SMARTERDESIGN UPGRADE TO EVERY SINGLE PAGE" moves this page off the Rewards
 * Circuit header's painted console onto the arena workspace: the chrome mast
 * (its description behind the chrome "?") and one arena case that holds the
 * sheet. The sheet prints its glass variant, which carries no frame of its
 * own, and DailyBonusPage.css dresses its insides only under this page's
 * arena root (readouts and the week on chrome tiles, every reward a chrome
 * row, Claim lit). The sheet's words, figures and claim behaviour are its own
 * and unchanged (tests/components/dailyBonusPageIsPinned.test.tsx).
 */
import { useUserStore } from '../stores/useUserStore';
import StandardContentLayout from '../components/layouts/StandardContentLayout';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import DailyBonusSheet from '../components/daily-bonus/DailyBonusSheet';
import '../components/ops/ArenaOps.css';
import './DailyBonusPage.css';
import { usePageTitle } from '../hooks/usePageTitle';

export default function DailyBonusPage() {
  usePageTitle('Bonuses');
  const accountId = useUserStore((state) => state.user?.id ?? null);
  return (
    <StandardContentLayout className="daily-bonus-page arena-workspace">
      <ArenaWorkspaceHeader
        area="finance"
        title="Daily Bonus"
        summary="Show Up Every Day For Progressively Bigger Rewards. Every Day Brings A Fresh Prize With No Back-To-Back Repeats, Scaling Multipliers, Milestone Chests, And A 100 Diamond Bonus Spin Every Tenth Day."
      />
      <section className="arena-case arena-ops-case daily-bonus-page__case">
        <h2 className="arena-section-title">
          Rewards Today<small>Daily Sheet Live</small>
        </h2>
        <DailyBonusSheet key={accountId ?? 'signed-out'} mode="inline" chassis="glass" />
      </section>
    </StandardContentLayout>
  );
}
