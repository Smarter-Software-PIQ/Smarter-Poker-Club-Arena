import { useNavigate } from 'react-router-dom';
import { useCanOperateUnionNetwork } from '../hooks/useCanCreateUnion';
import { useAuthUser } from '../hooks/useAuthUser';
import { useCashoutScope } from '../hooks/useCashoutScope';
import { useFinancialAdminScope } from '../hooks/useFinancialAdminScope';
import FinancialAdminScopeState from '../components/common/FinancialAdminScopeState';
import TransactionLedgerView from '../components/common/TransactionLedgerView';
import WeeklyAccountingWorkspace from '../components/accounting/WeeklyAccountingWorkspace';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { useClubStore } from '../stores/useClubStore';
import './SettlementDashboardPage.css';

const SUMMARY =
  'Verified Settlement Records. Weekly Accounting Is Posted Automatically, And Every Transaction Behind It Is Listed Below.';

/**
 * The Settlement Center: the weekly accounting of the club the finance scope
 * chose, and the chip ledger behind it.
 *
 * #SmarterDesign (batch S1, 2026-11-28): the two painted spade consoles are
 * gone. The page wears the arena workspace: Back as a chrome key above the
 * finance mast, the scope as a chrome status line, the weekly workspace in one
 * thin chrome case and the ledger in a second case under its section title.
 * Every handler, guard, region name and figure is unchanged
 * (tests/components/settlementDashboardIsPinned.test.tsx).
 */
export default function SettlementDashboardPage() {
  const scope = useFinancialAdminScope();
  const { user, isHydrating } = useAuthUser();
  const navigate = useNavigate();
  const { canOperateUnionNetwork } = useCanOperateUnionNetwork();
  const current = useCashoutScope(
    user?.id,
    JSON.stringify(['settlement-dashboard', scope.clubId, scope.userId, scope.status])
  );
  // The mast names the club the scope chose, from the membership already held;
  // with none held the line stays blank rather than naming another club.
  const clubName = useClubStore(
    (state) => state.memberships.find((m) => m.club?.id === scope.clubId)?.club?.name
  );
  if (scope.status !== 'ready') return <FinancialAdminScopeState scope={scope} arena />;
  if (!user?.id || isHydrating || scope.userId !== user.id || !current())
    return (
      <main className="settlement-dashboard-page arena-workspace">
        <ArenaWorkspaceHeader area="finance" title="Weekly Accounting" summary={SUMMARY} />
        <PageBar
          title="Weekly Accounting"
          titleAs={false}
          showHelp={false}
          status="Unavailable"
          statusTone="danger"
        />
        <section className="arena-case arena-ops-case settlement-dashboard-page__case">
          <p className="settlement-dashboard-page__state" role="alert">
            Accounting Is Unavailable Until This Account Is Ready.
          </p>
        </section>
      </main>
    );
  const scopeClubId = scope.clubId;
  const ledgerTitle = scopeClubId ? 'Club Transaction Records' : 'Your Account Transactions';
  return (
    <main className="settlement-dashboard-page arena-workspace">
      <div className="arena-switch arena-ops-keys settlement-dashboard-page__back">
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
      {/* Dan, 2026-10-17: "PAGES DON'T NEED TITLES LIKE THIS". What this page
          is lives behind the chrome "?". */}
      <ArenaWorkspaceHeader
        area="finance"
        title="Weekly Accounting"
        context={clubName || undefined}
        summary={SUMMARY}
      />
      <PageBar
        title="Weekly Accounting"
        titleAs={false}
        showHelp={false}
        status={scopeClubId ? 'Club' : 'Account'}
        statusTone="live"
      />
      <section className="arena-case arena-ops-case settlement-dashboard-page__case">
        {scopeClubId ? (
          <WeeklyAccountingWorkspace
            key={`${scopeClubId}:${user.id}`}
            scopeKind="club"
            scopeRef={scopeClubId}
          />
        ) : (
          <>
            <h2 className="arena-section-title">Choose A Scope</h2>
            <section
              className="settlement-dashboard-page__chooser"
              aria-label="Choose Accounting Scope"
            >
              <p>
                Choose A Club Or Union From Its Accounting Page To View A Specific Weekly Record.
              </p>
              <div className="arena-switch arena-ops-keys arena-ops-primary">
                <button type="button" onClick={() => navigate('/clubs')}>
                  Open Clubs
                </button>
                {canOperateUnionNetwork && (
                  <button type="button" onClick={() => navigate('/unions')}>
                    Open Unions
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </section>

      <section
        className="arena-case arena-ops-case settlement-dashboard-page__ledger"
        aria-label={ledgerTitle}
      >
        <h2 className="arena-section-title">
          {ledgerTitle}
          <small>Verified</small>
        </h2>
        {/* The case is the one region named ledgerTitle. The list keeps its own
            default name; passing ledgerTitle here as well gave the page two
            regions called "Club Transaction Records" (financial-admin-deep). */}
        {scopeClubId ? (
          <TransactionLedgerView
            clubId={scopeClubId}
            clubScoped
            key={`${scopeClubId}:${user.id}`}
            limit={25}
            arena
          />
        ) : (
          <TransactionLedgerView key={user.id} userId={user.id} limit={25} arena />
        )}
      </section>
    </main>
  );
}
