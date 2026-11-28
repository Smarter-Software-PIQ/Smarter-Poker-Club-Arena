import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  getClubIntegrityNavigation,
  type ClubIntegrityPageId,
} from '../../config/clubIntegrityNavigation';
import { useClubNavigationAccess } from '../../hooks/useClubNavigationAccess';
import ArenaWorkspaceHeader, { type ArenaWorkspaceArea } from '../lobby/ArenaWorkspaceHeader';
import PageBar from '../help/PageBar';
import '../ops/ArenaOps.css';

interface IntegrityMetric {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'active' | 'risk';
}

interface ClubIntegrityHeaderProps {
  clubId?: string;
  active: ClubIntegrityPageId;
  title: string;
  /** What the page is for. Shown behind the "?" in the top right, never on the page. */
  description: string;
  metrics: IntegrityMetric[];
  action?: ReactNode;
  /** Which mast art the page wears. Reports and Hand Review have their own. */
  area?: Extract<ArenaWorkspaceArea, 'reports' | 'handreview' | 'integrity'>;
}

const TONE: Record<NonNullable<IntegrityMetric['tone']>, 'default' | 'live' | 'attention'> = {
  neutral: 'default',
  active: 'live',
  risk: 'attention',
};

const AREA_FOR: Partial<Record<ClubIntegrityPageId, 'reports' | 'handreview'>> = {
  reports: 'reports',
  'hand-review': 'handreview',
};

/** The club's name as the route spells it; a raw UUID names nothing. */
function clubContext(clubId?: string): string | undefined {
  if (!clubId || /^[0-9a-f]{8}-/i.test(clubId)) return undefined;
  return clubId.replace(/[-_]/g, ' ');
}

/**
 * The top of the integrity and casework pages, in #SmarterDesign (Dan
 * 2026-11-27): the chrome mast with the club's name and the "?" help, the live
 * case counts as chrome meters, and the casework stops as one chrome switch
 * that lights the page you are on. The header carries its own arena
 * workspace so Disputes and Blacklist keep the dark mast on their own roots.
 */
export default function ClubIntegrityHeader({
  clubId,
  active,
  title,
  description,
  metrics,
  action,
  area,
}: ClubIntegrityHeaderProps) {
  const access = useClubNavigationAccess(clubId);
  const navigation = clubId ? getClubIntegrityNavigation(clubId, access) : [];

  return (
    <div className="arena-workspace arena-ops-embedded">
      <ArenaWorkspaceHeader
        area={area ?? AREA_FOR[active] ?? 'integrity'}
        title={title}
        context={clubContext(clubId)}
        summary={description}
      />
      <PageBar
        title={title}
        titleAs={false}
        showHelp={false}
        metrics={metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          tone: TONE[metric.tone || 'neutral'],
        }))}
      >
        {action}
      </PageBar>

      {navigation.length > 0 && (
        <nav aria-label="Integrity And Casework">
          <div className="arena-switch arena-ops-keys">
            {navigation.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                aria-current={item.id === active ? 'page' : undefined}
                className={item.id === active ? 'active' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
