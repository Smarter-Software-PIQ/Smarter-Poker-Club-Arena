/**
 * Poker Arena public landing page, on the #SmarterDesign arena workspace
 * (Batch H1, 2026-11-28).
 *
 * Until 2026-09-16 an anonymous visit to /hub/club-arena was a JavaScript
 * redirect to the World Hub login, and index.html said `noindex, nofollow`.
 * This page is what a signed-out visitor (and Googlebot) now gets at the
 * arena root: a real, static description of the product with its own title,
 * description, canonical and JSON-LD (see src/lib/seo.ts), and two ways in.
 * Signed-in players never see it; AuthGuard renders HomePage for them exactly
 * as before. Nothing here fetches, so it renders identically for a crawler
 * and a person.
 *
 * PRERENDER CONTRACT (src/prerender/entry-server.tsx -> dist/index.html):
 *   1. `<main className={styles.page} id="main-content" tabIndex={-1}>` stays
 *      the root landmark so prerender and runtime share one landmark;
 *   2. `<ArenaWorkspaceHeader>` prints the document's `<h1>Poker Arena</h1>`
 *      during SSR without reading browser APIs;
 *   3. both ways in remain real `<a href=...>` anchors so crawlers follow
 *      them without executing JavaScript;
 *   4. all four literal `trackCta(...)` calls and `signInUrl(returnPathAfterSignIn())`
 *      remain verbatim for the activation funnel and welcome-back laws.
 *
 * Copy is Title Case (repo rule, scripts/ci/check-title-case.mjs).
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import '../components/ops/ArenaOps.css';
import styles from './PokerArenaLandingPage.module.css';
import { signInUrl } from '../lib/signIn';
import { WEB_ORIGIN } from '../lib/appBase';
import { capture } from '../lib/analytics';

const SIGN_UP_URL = `${WEB_ORIGIN}/auth/signup?redirect=${encodeURIComponent('/hub/club-arena')}`;

const FEATURES = [
  {
    title: 'Private Poker Clubs',
    body: 'Create A Club, Set Your Own Stakes And Rules, Invite Your Players And Keep Every Game Inside Your Own Walls.',
  },
  {
    title: 'Real Time Cash Games',
    body: "Hold'em, Omaha, Short Deck And Pineapple At Tables That Deal In Real Time, With Straddles, Bomb Pots, Run It Twice And Insurance.",
  },
  {
    title: 'Tournaments',
    body: 'Schedule Multi Table Tournaments With Custom Blind Structures, Rebuys, Bounties And Automatic Payouts.',
  },
  {
    title: 'Hand Histories And Stats',
    body: 'Every Hand Is Recorded. Replay It, Share It And Study Player Statistics And Leaderboards Across Your Club.',
  },
  {
    title: 'Club Management',
    body: 'A Cashier, Chip Ledger, Agent System, Rake Settings, Reports And Settlement Tools Built For Club Owners.',
  },
  {
    title: 'Unions And Diamond Arena',
    body: 'Link Clubs Into Unions For Shared Player Pools. Diamond Arena Membership Is Automatic, But Funded Diamond Games Are Not Open For Play Yet.',
  },
];

const STEPS = [
  {
    title: 'Create Your Free Account',
    body: 'One Smarter.Poker Account Opens Poker Arena And Every Other Feature On The Platform.',
  },
  {
    title: 'Create Or Join A Club',
    body: 'Start Your Own Club In Minutes Or Join One With An Invite Code From Its Owner.',
  },
  {
    title: 'Sit Down And Play',
    body: 'Open The Lobby, Pick A Table Or Tournament And Play From Your Browser Or The Mobile App.',
  },
];

const RESOURCES = [
  { label: 'Help Center', to: '/help' },
  { label: 'Fair Gaming', to: '/legal/fair-gaming' },
  { label: 'Terms Of Service', to: '/legal/tos' },
  { label: 'Privacy Policy', to: '/legal/privacy' },
  { label: 'Promotion Rules', to: '/legal/promotions' },
];

const LANDING_VIEWED = 'landing_viewed';
const LANDING_CTA_CLICKED = 'landing_cta_clicked';

function trackCta(cta: 'sign_up' | 'sign_in', placement: 'hero' | 'closing'): void {
  capture(LANDING_CTA_CLICKED, { cta, placement, product: 'poker_arena' });
}

/**
 * Where Sign In brings the player back. The welcome-back chips email, the
 * join-a-club nudge and the play nudge land a signed-out player here with
 * ?join=<code>&ref=<referral> or ?welcome=chips (Dan 2026-11-04); the query
 * is what the home page acts on, so it travels through the login and back.
 */
function returnPathAfterSignIn(): string {
  if (typeof window === 'undefined') return '/';
  const search = window.location.search || '';
  return search.length > 1 ? `/${search}` : '/';
}

export default function PokerArenaLandingPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
    capture(LANDING_VIEWED, { product: 'poker_arena', referrer: document.referrer || null });
  }, []);

  const signInHref = signInUrl(returnPathAfterSignIn());

  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <div className={`${styles.workspace} arena-workspace`}>
        <ArenaWorkspaceHeader
          area="dashboard"
          context="Smarter.Poker"
          title="Poker Arena"
          subtitle="Private Online Poker Clubs"
          summary="Create Or Join A Private Poker Club, Play Real Time Cash Games And Tournaments With Your Own Players, And Run The Whole Club From One Dashboard."
        />

        <section className="arena-case arena-ops-case">
          <p className={styles.copy}>
            Create Or Join A Private Poker Club, Play Real Time Cash Games And Tournaments With Your
            Own Players, And Run The Whole Club From One Dashboard.
          </p>
          <p className={styles.copy}>
            A Free Smarter.Poker Account Opens Every Club, Table And Tournament In The Arena.
          </p>
          <div className={styles.ctaRow}>
            <div className="arena-switch arena-ops-keys">
              <a href={signInHref} onClick={() => trackCta('sign_in', 'hero')}>
                Sign In
              </a>
            </div>
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <a href={SIGN_UP_URL} onClick={() => trackCta('sign_up', 'hero')}>
                Create Account
              </a>
            </div>
          </div>
        </section>

        <section className="arena-case arena-ops-case" aria-labelledby="features-heading">
          <div className="arena-section-title">
            <h2 id="features-heading">Everything A Club Needs</h2>
            <small>Six</small>
          </div>
          <ul className={styles.rows}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.row}>
                <h3 className={styles.rowTitle}>{feature.title}</h3>
                <p className={styles.copy}>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="arena-case arena-ops-case" aria-labelledby="steps-heading">
          <div className="arena-section-title">
            <h2 id="steps-heading">How Poker Arena Works</h2>
            <small>Three</small>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <div className={styles.stepBody}>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.copy}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="arena-case arena-ops-case" aria-labelledby="trust-heading">
          <div className="arena-section-title">
            <h2 id="trust-heading">Fair Play, In Writing</h2>
            <small>Public</small>
          </div>
          <p className={styles.copy}>
            Every Table Runs On A Server Side Shuffle With Collusion Detection And Anti Cheat
            Monitoring. The Rules Are Public: Read The Fair Gaming Standards, The Terms Of Service
            And The Privacy Policy Before You Sit Down.
          </p>
          <nav className={styles.links} aria-label="Poker Arena Resources">
            {RESOURCES.map((resource) => (
              <Link key={resource.to} className={styles.link} to={resource.to}>
                {resource.label}
              </Link>
            ))}
            <a className={styles.link} href={`${WEB_ORIGIN}/hub`}>
              Smarter.Poker World Hub
            </a>
          </nav>
        </section>

        <section className="arena-case arena-ops-case" aria-labelledby="closing-heading">
          <div className="arena-section-title">
            <h2 id="closing-heading">Ready To Deal?</h2>
            <small>Free</small>
          </div>
          <p className={`${styles.copy} ${styles.copyCenter}`}>
            Sign In To Poker Arena, Or Create A Free Account And Open Your First Club In Minutes.
          </p>
          <div className={styles.ctaRow}>
            <div className="arena-switch arena-ops-keys">
              <a href={signInHref} onClick={() => trackCta('sign_in', 'closing')}>
                Sign In
              </a>
            </div>
            <div className="arena-switch arena-ops-keys arena-ops-primary">
              <a href={SIGN_UP_URL} onClick={() => trackCta('sign_up', 'closing')}>
                Create Account
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
