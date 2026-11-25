import './ArenaWorkspace.css';

const artwork = {
  members: 'club-members/roster-vault.webp',
  cashier: 'cashier/cashier-vault-hero-v1.webp',
  data: 'club-data/data-vault-hero-v1.webp',
  stats: 'stats/player-intelligence-console-v1.webp',
} as const;

interface Props {
  area: keyof typeof artwork;
  title: string;
  context?: string | null;
  subtitle: string;
  id?: string;
}

export default function ArenaWorkspaceHeader({ area, title, context, subtitle, id }: Props) {
  return (
    <header className="arena-workspace-mast">
      <i
        aria-hidden="true"
        className="arena-mast-art"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/${artwork[area]})` }}
      />
      <span>{context || 'Club Arena'}</span>
      <h1 id={id}>{title}</h1>
      <small>{subtitle}</small>
    </header>
  );
}
