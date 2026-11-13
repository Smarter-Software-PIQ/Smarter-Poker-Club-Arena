import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayerSearchService, type MemberLiveTable } from '../../services/PlayerSearchService';
import { useToast } from '../common/Toast';
import { reportError } from '../../utils/errorReporter';
import { titleCase } from '../../utils/titleCase';
import { WatchAtTableButton } from './WatchAtTableButton';
import { withStakes } from '../../utils/tableEyebrow';
import { WATCH_ERROR_MESSAGE, WATCH_LEFT_MESSAGE, watchMemberTable } from './watchMemberTable';

/**
 * WATCH AT TABLE ON THE PLAYER RECORD (Dan 2026-10-16)
 *
 * "WHEN YOU ARE INSIDE OF PLAYER MANAGEMENT, AND THE PLAYER IS 'AT A TABLE'
 * THERE SHOULD BE A BUTTON TO EASILY CLICK TO BE REDIRECTED AND WATCH THEM."
 *
 * The record already knows the player is seated (ca_club_member_detail's
 * presence.is_seated); this finds EVERY table, prints the painted Watch At
 * Table shell, and on a tap revalidates access with the same
 * fn_get_table_watch_access the Find A Player locator uses before routing to
 * the observer view. A seat the viewer cannot read, or a table that closed in
 * the meantime, renders nothing rather than a button that would be refused.
 */
export interface MemberWatchAtTableProps {
  clubUuid: string;
  memberUserId: string;
  memberName?: string;
  /** presence.is_seated from the record; nothing is fetched while false. */
  seated: boolean;
  refreshKey?: number;
  /** Printed instead while no live table is known. */
  fallback?: ReactNode;
}

export default function MemberWatchAtTable({
  clubUuid,
  memberUserId,
  memberName = 'Player',
  seated,
  refreshKey = 0,
  fallback = null,
}: MemberWatchAtTableProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [tables, setTables] = useState<MemberLiveTable[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const busyRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    busyRef.current = false;
    setVerifying(null);
    setTables([]);
    if (!seated || !clubUuid || !memberUserId) return;
    PlayerSearchService.getMemberLiveTables(memberUserId, clubUuid)
      .then((live) => {
        if (generationRef.current === generation) setTables(live);
      })
      .catch((error) => {
        if (generationRef.current === generation) {
          reportError(error, 'MemberWatchAtTable.LiveTable');
        }
      });
    return () => {
      generationRef.current += 1;
    };
  }, [clubUuid, memberUserId, seated, refreshKey]);

  if (!tables.length) return <>{fallback}</>;

  const watch = async (table: MemberLiveTable) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = generationRef.current;
    setVerifying(table.table_id);
    try {
      const outcome = await watchMemberTable(navigate, table, {
        userId: memberUserId,
        name: memberName,
      });
      if (generationRef.current !== generation) return;
      if (outcome.status === 'left') {
        setTables((current) => current.filter((item) => item.table_id !== table.table_id));
        toast.error(WATCH_LEFT_MESSAGE);
      } else if (outcome.status === 'refused') {
        toast.error(outcome.message);
      } else if (outcome.status === 'error') {
        toast.error(WATCH_ERROR_MESSAGE);
      }
    } finally {
      if (generationRef.current === generation) {
        busyRef.current = false;
        setVerifying(null);
      }
    }
  };

  return (
    <div className="mm-watch" role="group" aria-label="Current Tables">
      {tables.map((table) => {
        const name = titleCase(table.name);
        const stakes = titleCase(table.stakes);
        return (
          <WatchAtTableButton
            key={table.table_id}
            onClick={() => void watch(table)}
            disabled={verifying !== null}
            socket={table.is_tournament ? 'MTT' : 'Cash'}
            eyebrow={withStakes(name, stakes)}
            title={verifying === table.table_id ? 'Verifying Access' : 'Watch At Table'}
            ariaLabel={`Watch At Table, ${name}`}
          />
        );
      })}
    </div>
  );
}
