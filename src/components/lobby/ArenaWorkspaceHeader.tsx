import type { ReactNode } from 'react';
import PageHelp, { type TutorialStep } from '../help/PageHelp';
import './ArenaWorkspace.css';

const scene = {
  members: 'club-members/player-instrument-felt-v1.webp',
  record: 'club-members/roster-ledger-desk-v2.webp',
  cashier: 'cashier/cashier-vault-hero-v1.webp',
  data: 'club-data/data-vault-hero-v1.webp',
  stats: 'stats/player-intelligence-console-v1.webp',
  // Club Operations and its pages (Dan 2026-11-27: #SmarterDesign on every page).
  operations: 'club-members/roster-vault.webp',
  dashboard: 'club-management/table-command-hero-v1.webp',
  reports: 'account/signal-desk-hero-v1.webp',
  integrity: 'account/signal-desk-hero-v1.webp',
  handreview: 'account/public-dossier-hero-v1.webp',
  finance: 'wallet/value-vault-hero-v1.webp',
  control: 'account/control-room-hero-v1.webp',
  settings: 'account/identity-vault-hero-v1.webp',
} as const;

export type ArenaWorkspaceArea = keyof typeof scene;

const helpSummary = {
  members: 'Find Any Member, Read Their Live Club Status, And Open The Controls Behind Their Seat.',
  record: 'Review This Player’s Club Activity, Balances And History For The Selected Dates.',
  cashier:
    'Move Chips Between Your Club Wallets, Answer Chip Requests, Redeem Tickets And Check Every Ledger Entry.',
  data: 'Track Every Game, Fee, Player Result, And Union Square-Up From One Operator-Grade View.',
  stats: 'Your Recorded Analysis Sample, Distilled Into Patterns You Can Use At The Next Table.',
  operations:
    'Every Club Tool In One Place: What Needs You Now, The Live Club Readings And A Door To Each Workspace.',
  dashboard:
    'Your Club At A Glance: Today’s Rake, Hosted Hands, Activity And The Tables Running Now.',
  reports:
    'Read Every Player Report, Take The Ones That Need A Decision And Close Them With A Ruling.',
  integrity: 'Review Disputes, Flags And Restrictions That Keep Your Club Fair.',
  handreview: 'Look Up Any Hand, Review Flagged Hands And Record What Was Decided.',
  finance: 'Read The Club’s Money At A Glance And Open The Tool That Handles Each Balance.',
  control: 'Set Who Can Join, What Members Read First And Which Club Controls Need Attention.',
  settings: 'Edit The Club’s Identity, Joining Policy, Invites And Ownership.',
} satisfies Record<keyof typeof scene, string>;

interface Props {
  area: keyof typeof scene;
  title: string;
  context?: string | null;
  subtitle?: string;
  id?: string;
  helpTitle?: string;
  summary?: string;
  steps?: TutorialStep[];
  /** Seats something of the page's own in the medallion, such as the club's logo. */
  emblem?: ReactNode;
}

function WorkspaceEmblem({ area }: Pick<Props, 'area'>) {
  const base = import.meta.env.BASE_URL;
  if (area === 'record') {
    return (
      <span className="arena-mast-credential">
        <img
          src={base + 'assets/club-buttons/wallets/emblems/wallet-emblem-player-v1.webp'}
          alt=""
        />
        <i />
      </span>
    );
  }
  if (area === 'members') {
    return (
      <span className="arena-mast-portrait-pair">
        <img
          src={base + 'assets/club-buttons/wallets/emblems/wallet-emblem-agent-v1.webp'}
          alt=""
        />
        <img
          src={base + 'assets/club-buttons/wallets/emblems/wallet-emblem-player-v1.webp'}
          alt=""
        />
      </span>
    );
  }
  if (area === 'settings') {
    return (
      <span className="arena-mast-credential">
        <img
          src={base + 'assets/club-buttons/wallets/emblems/wallet-emblem-agent-v1.webp'}
          alt=""
        />
        <i />
      </span>
    );
  }
  if (area === 'operations') {
    return (
      <span className="arena-mast-portrait-pair">
        <img
          src={base + 'assets/club-buttons/wallets/emblems/wallet-emblem-agent-v1.webp'}
          alt=""
        />
        <img
          src={base + 'assets/club-buttons/wallets/emblems/wallet-emblem-player-v1.webp'}
          alt=""
        />
      </span>
    );
  }
  if (area === 'cashier' || area === 'finance') {
    return <span className="arena-mast-cash-chips" />;
  }
  if (area === 'data' || area === 'dashboard') {
    return (
      <span className="arena-mast-bars">
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  }
  return (
    <span className="arena-mast-dial">
      <i />
    </span>
  );
}

export default function ArenaWorkspaceHeader({
  area,
  title,
  context,
  subtitle,
  id,
  helpTitle,
  summary,
  steps,
  emblem,
}: Props) {
  return (
    <header className="arena-workspace-mast" data-mast={area}>
      <div
        className="arena-mast-panorama"
        aria-hidden="true"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/${scene[area]})` }}
      />
      <div className="arena-mast-medallion" aria-hidden="true">
        {emblem ?? <WorkspaceEmblem area={area} />}
      </div>
      <div className="arena-mast-lettering">
        <span>{context || 'Club Arena'}</span>
        <h1 id={id}>{title}</h1>
        {subtitle && <small>{subtitle}</small>}
      </div>
      <PageHelp title={helpTitle ?? title} summary={summary ?? helpSummary[area]} steps={steps} />
    </header>
  );
}
