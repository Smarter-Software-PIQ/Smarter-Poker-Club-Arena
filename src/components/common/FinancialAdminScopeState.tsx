/**
 * What an admin money page renders while its club scope is not `ready`.
 *
 * One component so the five global-path money pages agree on the three
 * non-ready answers: loading (wait, render nothing financial), denied (the
 * viewer holds no finance role anywhere, or not in the club they named) and
 * error (the club could not be found or the membership could not be read).
 * A page that has not been handed a club renders THIS, never a table of
 * somebody's numbers with an empty filter.
 */
import { useNavigate } from 'react-router-dom';
import type { FinancialAdminScope } from '../../hooks/useFinancialAdminScope';
import { SpadeConsole } from '../console/SpadeConsole';
import ArenaWorkspaceHeader from '../lobby/ArenaWorkspaceHeader';
import PageBar from '../help/PageBar';
import styles from './FinancialAdminScopeState.module.css';
import './FinancialAdminScopeArena.css';

/**
 * `arena` (#SmarterDesign batch S1, 2026-11-28, opt-in): a host that is an
 * arena workspace page (the Settlement Center) gets the same three answers on
 * the workspace: the finance mast, the verdict as a chrome status line, the
 * message in a thin chrome case and Retry / Back as chrome keys, Retry lit.
 * The words, roles and handlers are the painted version's. Hosts that do not
 * pass it keep the painted console.
 */
export default function FinancialAdminScopeState({
  scope,
  arena = false,
}: {
  scope: FinancialAdminScope;
  arena?: boolean;
}) {
  const navigate = useNavigate();
  const denied = scope.status === 'denied';
  const failed = scope.status === 'error';
  const message = denied
    ? scope.message || 'Your Role Does Not Include Finance Access.'
    : failed
      ? scope.message || 'Your Club Access Could Not Be Verified.'
      : 'Checking Your Club Finance Access.';

  if (arena) {
    const title = denied ? 'Financial Access Restricted' : 'Financial Access';
    return (
      <main className="financial-scope-state arena-workspace">
        <ArenaWorkspaceHeader area="finance" title={title} />
        <PageBar
          title={title}
          titleAs={false}
          showHelp={false}
          status={denied ? 'Restricted' : failed ? 'Unavailable' : 'Checking'}
          statusTone={denied || failed ? 'danger' : 'live'}
        />
        <section className="arena-case arena-ops-case financial-scope-state__case">
          <p
            className="financial-scope-state__message"
            role={denied || failed ? 'alert' : 'status'}
          >
            {message}
          </p>
          {(failed || denied) && (
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              {failed && (
                <button type="button" onClick={scope.reload}>
                  Retry
                </button>
              )}
              <button type="button" onClick={() => navigate(-1)}>
                Back
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <SpadeConsole
        family={failed ? 'riveted' : denied ? 'shark' : 'spade'}
        crest={denied ? 'flat' : 'spade'}
        eyebrow="Club Arena Data"
        title={denied ? 'Financial Access Restricted' : 'Financial Access'}
        subtitle={message}
        pill={denied ? 'Restricted' : failed ? 'Unavailable' : 'Checking'}
        pillInk={denied || failed ? 'red' : 'blue'}
        foot={failed || denied ? 'plates' : 'foot'}
        plates={
          failed
            ? {
                secondary: { label: 'Back', onClick: () => navigate(-1) },
                primary: { label: 'Retry', onClick: scope.reload },
              }
            : denied
              ? { primary: { label: 'Back', onClick: () => navigate(-1) } }
              : undefined
        }
      >
        <p className="sc-copy sc-copy--center" role={denied || failed ? 'alert' : 'status'}>
          {message}
        </p>
      </SpadeConsole>
    </main>
  );
}
