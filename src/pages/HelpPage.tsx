import { usePlayerPreference } from '../hooks/usePlayerPreference';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import FeedbackForm from '../components/support/FeedbackForm';
import SystemStatus from '../components/support/SystemStatus';
import styles from './HelpPage.module.css';
import PageBar from '../components/help/PageBar';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import '../components/ops/ArenaOps.css';
import { FAQ_ITEMS, QUICK_LINKS } from './helpContent';

/* The words the hero used to print. They live behind the "?" now; the
   prerender carries the same sentence. */
const HELP_SUMMARY =
  'Search Verified Poker Arena Guidance, Check The Live Data Circuit, Or Send A Request Directly To Support.';

export default function HelpPage() {
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = usePlayerPreference('HelpPage:searchQuery', '');
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  useEffect(() => {
    document.title = 'Poker Arena Help Center | Smarter.Poker';
  }, []);

  const closeFeedbackForm = useCallback(() => setShowFeedbackForm(false), []);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredFAQ = useMemo(
    () =>
      FAQ_ITEMS.filter(
        (item) =>
          !normalizedQuery ||
          item.category.toLowerCase().includes(normalizedQuery) ||
          item.question.toLowerCase().includes(normalizedQuery) ||
          item.answer.toLowerCase().includes(normalizedQuery)
      ),
    [normalizedQuery]
  );

  return (
    <article className={`${styles.page} arena-workspace`} aria-labelledby="help-title">
      {/* #SmarterDesign (Dan 2026-11-27): the arena mast carries the title and
          the chrome "?", whose panel holds the page summary; the page bar
          under it keeps only the two support actions. */}
      <ArenaWorkspaceHeader
        area="reports"
        title="Help Center"
        id="help-title"
        summary={HELP_SUMMARY}
      />
      <PageBar className={styles.bar} title="Help Center" titleAs={false} showHelp={false}>
        <div className={`${styles.barActions} arena-switch arena-ops-keys arena-ops-primary`}>
          <button type="button" onClick={() => setShowFeedbackForm(true)}>
            Send Support Request
          </button>
          <a href="mailto:support@smarter.poker">Email Support</a>
        </div>
      </PageBar>

      <section
        className={`${styles.statusDeck} arena-case arena-ops-case`}
        aria-label="Live Platform Status"
      >
        <SystemStatus />
      </section>

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
          <label className={styles.searchField}>
            <span>Search Help</span>
            <input
              type="search"
              className="arena-ops-well"
              placeholder="Search Clubs, Rewards, Safety..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <div className={styles.faqList}>
          {filteredFAQ.map((item) => {
            const isExpanded = expandedQuestion === item.question;
            const answerId = `faq-${item.question.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            return (
              <article
                className={`${styles.faqItem} arena-ledger-row ${isExpanded ? styles.expanded : ''}`}
                key={item.question}
              >
                <button
                  type="button"
                  onClick={() => setExpandedQuestion(isExpanded ? null : item.question)}
                  aria-expanded={isExpanded}
                  aria-controls={answerId}
                >
                  <span className={styles.category}>{item.category}</span>
                  <strong>{item.question}</strong>
                  <span className={styles.toggle} aria-hidden="true">
                    {isExpanded ? '−' : '+'}
                  </span>
                </button>
                {/* AEO PHASE 1 (2026-09-17): the answer is always in the DOM and
                    hidden when collapsed, instead of not rendered at all. A
                    crawler that renders the page, and a screen reader, now
                    get every answer; the toggle behaves as it did. */}
                <div className={styles.answer} id={answerId} hidden={!isExpanded}>
                  {item.answer}
                </div>
              </article>
            );
          })}

          {filteredFAQ.length === 0 && (
            <div className={styles.emptyState} role="status">
              <strong>No Matching Help Topics</strong>
              <span>Try A Broader Search Or Send A Support Request.</span>
            </div>
          )}
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

      <FeedbackForm isOpen={showFeedbackForm} onClose={closeFeedbackForm} />
    </article>
  );
}
