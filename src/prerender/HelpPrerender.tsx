/**
 * The Help Center as static HTML (AEO phase 1, 2026-09-17).
 *
 * HelpPage renders the same words with search, a collapse toggle, the live
 * status deck and the support form, which need React state and the app's
 * providers (toast, auth, Supabase). None of that exists for a reader that
 * never runs the bundle, so the prerender renders the questions and answers
 * themselves, every answer open, with the same classes from
 * HelpPage.module.css so it looks like the page it stands in for. The copy
 * comes from src/pages/helpContent.ts: one source, two renderers. Both print
 * the same #SmarterDesign mast (2026-11-28): the Help Center title is the
 * mast's h1 and its summary sits behind the chrome "?" (Dan 2026-10-17:
 * "PAGES DON'T NEED TITLES LIKE THIS").
 */
import { Link } from 'react-router-dom';
import styles from '../pages/HelpPage.module.css';
import { FAQ_ITEMS, QUICK_LINKS } from '../pages/helpContent';
import PageBar from '../components/help/PageBar';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import '../components/ops/ArenaOps.css';

/* The words the hero used to print. They live behind the "?" now; the
   prerender carries the same sentence. */
const HELP_SUMMARY =
  'Search Verified Poker Arena Guidance, Check The Live Data Circuit, Or Send A Request Directly To Support.';

export default function HelpPrerender() {
  return (
    <article className={`${styles.page} arena-workspace`} aria-labelledby="help-title">
      {/* The same #SmarterDesign mast and page bar HelpPage prints (2026-11-28). */}
      <ArenaWorkspaceHeader
        area="reports"
        title="Help Center"
        id="help-title"
        summary={HELP_SUMMARY}
      />
      <PageBar className={styles.bar} title="Help Center" titleAs={false} showHelp={false}>
        <div className={`${styles.barActions} arena-switch arena-ops-keys`}>
          <a href="mailto:support@smarter.poker">Email Support</a>
        </div>
      </PageBar>

      <nav
        className={`${styles.quickLinks} arena-switch arena-ops-keys`}
        aria-label="Common Help Destinations"
      >
        {QUICK_LINKS.map((item) => (
          <Link to={item.path} key={item.path}>
            {item.label}
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>

      <section
        className={`${styles.knowledge} arena-case arena-ops-case`}
        aria-labelledby="faq-title"
      >
        <div className={styles.knowledgeHeader}>
          <h2 id="faq-title" className="arena-section-title">
            Frequently Asked Questions
          </h2>
        </div>

        <div className={styles.faqList}>
          {FAQ_ITEMS.map((item) => {
            const answerId = `faq-${item.question.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            return (
              <article
                className={`${styles.faqItem} arena-ledger-row ${styles.expanded}`}
                key={item.question}
              >
                <h3>
                  <span className={styles.category}>{item.category}</span>
                  <strong>{item.question}</strong>
                </h3>
                <div className={styles.answer} id={answerId}>
                  {item.answer}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Support@Smarter.Poker</span>
        <nav className="arena-switch arena-ops-keys" aria-label="Support Policies">
          <Link to="/legal">Legal Center</Link>
          <Link to="/legal/privacy">Privacy</Link>
          <Link to="/legal/tos">Terms</Link>
        </nav>
      </footer>
    </article>
  );
}
