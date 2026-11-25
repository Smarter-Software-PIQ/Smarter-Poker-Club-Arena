import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import StatsGameModeControl from './StatsGameModeControl';

export default function StatsWorkspaceHeader({ context }: { context: string }) {
  return (
    <>
      <ArenaWorkspaceHeader
        area="stats"
        title="Player Stats"
        context={context}
        subtitle="Player Intelligence"
        id="stats-page-title"
      />
      <StatsGameModeControl />
    </>
  );
}
