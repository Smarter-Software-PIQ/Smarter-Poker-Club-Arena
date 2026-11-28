import { useParams, useNavigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import WeeklyAccountingWorkspace from '../components/accounting/WeeklyAccountingWorkspace';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import { ArenaState } from '../components/ops/ArenaOps';
import { useArenaClubName } from '../components/ops/useArenaClubName';
import './SettlementPage.css';

const SUMMARY =
  'Weekly Accounting For This Club Or Union Is Posted Automatically And Verified. Nothing Here Opens, Closes Or Pays A Week By Hand.';

/** The union's name as the route spells it; a raw UUID names nothing. */
function routeContext(reference?: string): string | undefined {
  if (!reference || /^[0-9a-f]{8}-/i.test(reference)) return undefined;
  return reference.replace(/[-_]/g, ' ');
}

/**
 * Route-scoped automatic accounting. No browser open, close or payout controls.
 *
 * #SmarterDesign (Dan 2026-11-27): the painted spade console is gone. The page
 * wears the arena workspace: the finance mast with the club's name, the scope
 * as a chrome status line, Back as a chrome key above the case and the weekly
 * workspace inside one thin chrome case.
 */
export default function SettlementPage() {
  const { clubId, unionId } = useParams<{ clubId: string; unionId: string }>();
  const { user } = useAuthUser();
  const navigate = useNavigate();
  const kind = clubId && !unionId ? 'club' : unionId && !clubId ? 'union' : null;
  const reference = kind === 'club' ? clubId : unionId;
  const clubName = useArenaClubName();
  return (
    <main className="settlement-page arena-workspace">
      <div className="arena-switch arena-ops-keys">
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
      {/* Dan, 2026-10-17: what this page is lives behind the "?". */}
      <ArenaWorkspaceHeader
        area="finance"
        title="Weekly Accounting"
        context={kind === 'club' ? clubName : routeContext(reference)}
        summary={SUMMARY}
      />
      <PageBar
        title="Weekly Accounting"
        titleAs={false}
        showHelp={false}
        status={kind === 'club' ? 'Club' : kind === 'union' ? 'Union' : 'Unavailable'}
        statusTone={kind ? 'live' : 'danger'}
      />
      <section className="arena-case arena-ops-case settlement-page__case">
        {kind && reference ? (
          <WeeklyAccountingWorkspace
            key={`${kind}:${reference}:${user?.id ?? ''}`}
            scopeKind={kind}
            scopeRef={reference}
          />
        ) : (
          <ArenaState
            tone="error"
            title="Weekly Accounting"
            message="Choose A Club Or Union To View Its Weekly Accounting."
          />
        )}
      </section>
    </main>
  );
}
