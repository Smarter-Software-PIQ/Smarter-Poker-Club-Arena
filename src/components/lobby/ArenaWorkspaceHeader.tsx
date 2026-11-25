import './ArenaWorkspace.css';

const scene = {
  members: 'club-members/player-instrument-felt-v1.webp',
  cashier: 'cashier/cashier-vault-hero-v1.webp',
  data: 'club-data/data-vault-hero-v1.webp',
  stats: 'stats/player-intelligence-console-v1.webp',
} as const;

interface Props {
  area: keyof typeof scene;
  title: string;
  context?: string | null;
  subtitle: string;
  id?: string;
}

function WorkspaceEmblem({ area }: Pick<Props, 'area'>) {
  const base = import.meta.env.BASE_URL;
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

export default function ArenaWorkspaceHeader({ area, title, context, subtitle, id }: Props) {
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
        <small>{subtitle}</small>
      </div>
    </header>
  );
}
