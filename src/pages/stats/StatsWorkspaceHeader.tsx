import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import type { TutorialStep } from '../../components/help/PageHelp';
import StatsGameModeControl from './StatsGameModeControl';

/* The hero's paragraph and the section descriptions live behind the "?" now
   (Dan, 2026-10-17). Each step lights the control it names; a step whose
   target is not on screen (the club console in the Diamond Arena) shows its
   words without lighting anything. */
const STATS_TOUR: TutorialStep[] = [
  {
    title: 'Club Scope',
    body: 'Pick All Clubs Or One Club. Every Readout Below Is Restricted To The Club You Choose.',
    target: '.stats-club-command',
  },
  {
    title: 'Analysis Window',
    body: 'Choose The Range Every Figure On This Page Is Measured Over, And See When It Last Updated.',
    target: '.stats-range-control',
  },
  {
    title: 'Headline Performance',
    body: 'Hands Won, Total Hands, Cash Result And BB/100 For The Window You Picked.',
    target: '.stats-hero',
  },
  {
    title: 'Evidence At A Glance',
    body: 'Sample-Aware Facts From This Window. Coaching Requires A Persisted Assistant Report.',
    target: '#stats-brief-title',
  },
  {
    title: 'Deep Analysis',
    body: 'Switch Between Overview, Performance, Positions, Hands And The Rest Of Your Dossier.',
    target: '.stats-pill-tabs',
  },
];

export const sharedStatsHelp =
  'An Authorized Shared-Club Readout: Public Performance Aggregates From A Club You Both Currently Share.';

export default function StatsWorkspaceHeader({
  context,
  shared = false,
}: {
  context: string;
  shared?: boolean;
}) {
  return (
    <>
      <ArenaWorkspaceHeader
        area="stats"
        title="Player Stats"
        context={context}
        id="stats-page-title"
        helpTitle="Player Intelligence"
        summary={shared ? sharedStatsHelp : undefined}
        steps={shared ? undefined : STATS_TOUR}
      />
      <StatsGameModeControl />
    </>
  );
}
