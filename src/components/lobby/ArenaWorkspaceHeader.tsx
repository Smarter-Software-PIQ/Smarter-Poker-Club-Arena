import PageHelp, { type TutorialStep } from '../help/PageHelp';
import './ArenaWorkspace.css';

const scene = {
  members: 'club-members/player-instrument-felt-v1.webp',
  record: 'club-members/roster-ledger-desk-v2.webp',
  cashier: 'cashier/cashier-vault-hero-v1.webp',
  data: 'club-data/data-vault-hero-v1.webp',
  stats: 'stats/player-intelligence-console-v1.webp',
} as const;

const helpSummary = {
  members: 'Find Any Member, Read Their Live Club Status, And Open The Controls Behind Their Seat.',
  record: 'Review This Player’s Club Activity, Balances And History For The Selected Dates.',
  cashier:
    'Move Chips Between Your Club Wallets, Answer Chip Requests, Redeem Tickets And Check Every Ledger Entry.',
  data: 'Track Every Game, Fee, Player Result, And Union Square-Up From One Operator-Grade View.',
  stats: 'Your Recorded Analysis Sample, Distilled Into Patterns You Can Use At The Next Table.',
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
  if (area === 'cashier') {
    return <span className="arena-mast-cash-chips" />;
  }
  if (area === 'data') {
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
}: Props) {
  return (
    <header className="arena-workspace-mast" data-mast={area}>
      <div
        className="arena-mast-panorama"
        aria-hidden="true"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/${scene[area]})` }}
      />
      <div className="arena-mast-medallion" aria-hidden="true">
        <WorkspaceEmblem area={area} />
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
