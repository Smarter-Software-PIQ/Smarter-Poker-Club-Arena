import { useParams, useNavigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import WeeklyAccountingWorkspace from '../components/accounting/WeeklyAccountingWorkspace';
/* #SmarterDesign (Dan 2026-11-27): the painted console is the old style for a
   page section; Weekly Accounting prints in the thin chrome case. Only the
   shell changes: the accounting workspace inside is untouched. */
import { ClubPageSection as SpadeConsole } from '../components/club/ClubPageSection';
import '../components/console/SpadeConsole.css';
import '../components/lobby/ArenaWorkspace.css';
import PageBar from '../components/help/PageBar';
import styles from './SettlementPage.module.css';

/** Route-scoped automatic accounting. No browser open, close or payout controls. */
export default function SettlementPage() {
  const { clubId, unionId } = useParams<{ clubId: string; unionId: string }>();
  const { user } = useAuthUser();
  const navigate = useNavigate();
  const kind = clubId && !unionId ? 'club' : unionId && !clubId ? 'union' : null;
  const reference = kind === 'club' ? clubId : unionId;
  return (
    <main className={`${styles.page} arena-workspace`}>
      {/* Dan, 2026-10-17: the decorative eyebrow is gone; what this page is
          lives behind the painted "?". */}
      <PageBar
        title="Weekly Accounting"
        titleAs={false}
        summary="Weekly Accounting For This Club Or Union Is Posted Automatically And Verified. Nothing Here Opens, Closes Or Pays A Week By Hand."
      />
      <SpadeConsole
        arena
        className={styles.console}
        family="spade"
        title="Weekly Accounting"
        titleAs="h1"
        pill={kind === 'club' ? 'Club' : kind === 'union' ? 'Union' : 'Unavailable'}
        pillInk={kind ? 'blue' : 'red'}
        foot="foot"
      >
        <span className={`arena-switch ${styles.backKeys}`}>
          <button type="button" className={styles.backButton} onClick={() => navigate(-1)}>
            Back
          </button>
        </span>
        {kind && reference ? (
          <WeeklyAccountingWorkspace
            key={`${kind}:${reference}:${user?.id ?? ''}`}
            scopeKind={kind}
            scopeRef={reference}
          />
        ) : (
          <p className={`${styles.state} sc-ink--red`} role="alert">
            Choose A Club Or Union To View Its Weekly Accounting.
          </p>
        )}
      </SpadeConsole>
    </main>
  );
}
