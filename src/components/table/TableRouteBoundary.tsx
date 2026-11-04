import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { isRetiredTableId } from '../../lib/retiredTournamentVisibility';
import { isUUID } from '../../utils/clubIdResolver';
import { EmptyState } from '../common/EmptyState';

/** Reject malformed entry points before any live table hook can mount. */
export function TableRouteBoundary({
  embeddedTableId,
  children,
}: {
  embeddedTableId?: string;
  children: (tableId: string) => ReactNode;
}) {
  const { tableId: routeTableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const tableId = embeddedTableId || routeTableId;

  // Refuse the retired cohort before mounting any engine or seating hooks.
  // MultiTablePage removes embedded tabs; standalone bookmarks return to the lobby.
  if (isRetiredTableId(tableId)) {
    return embeddedTableId ? null : <Navigate to="/" replace />;
  }

  if (!tableId || !isUUID(tableId)) {
    return (
      <EmptyState
        title="Table Unavailable"
        description="This Table Link Is Invalid. Open A Table From The Lobby."
        action={{ label: 'Return To Lobby', onClick: () => navigate('/') }}
      />
    );
  }
  return children(tableId);
}
