/**
 * UNION DATA
 * ============================================================================
 * What the union produced, without walking into one of its clubs first.
 *
 * The rake snapshot has answered the union question since it was built, but
 * only from inside a member club: the panel derived the union from whichever
 * club the operator happened to open. A union lead who owns no club had no
 * door at all, and one who owns two had to pick a club and hope the figure
 * above it was the union's rather than that club's.
 *
 * So this page hands the panel the UNION directly. Every scope below it is
 * still gated in the database - ca_can_oversee_union for the union itself,
 * ca_can_view_club_finances for a club opened from the list - and the panel
 * reports a refusal rather than painting a zero.
 *
 * Deliberately not a second statements page. Statements are the billing
 * record and live at /unions/:unionId/statements; this is production.
 *
 * #SmarterDesign (batch U1, 2026-11-28): the Club Data layout. The chrome
 * mast (area data) heads the page, the union and its club count sit on the
 * chrome meters under it with Union and Statements as chrome keys
 * (Statements lit), and the shared rake snapshot panel follows on the root
 * skin's chrome case. Every printed word and control is pinned by
 * tests/components/unionDataPageIsPinned.test.tsx.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUnionRouteId } from '../hooks/useUnionRouteId';
import { supabase } from '../lib/supabase';
import { useAuthUser } from '../hooks/useAuthUser';
import { useCanOperateUnionNetwork } from '../hooks/useCanCreateUnion';
import { reportError } from '../utils/errorReporter';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import PageBar from '../components/help/PageBar';
import RakeSnapshotPanel from '../components/club/RakeSnapshotPanel';
import { titleCase } from '../utils/titleCase';
import './UnionDataPage.css';

export default function UnionDataPage() {
  const { unionId, unionRef } = useUnionRouteId();
  const navigate = useNavigate();
  const { user } = useAuthUser();
  const { canOperateUnionNetwork } = useCanOperateUnionNetwork();

  const [unionName, setUnionName] = useState<string | null>(null);
  const [clubCount, setClubCount] = useState<number | null>(null);
  const [unionNameReady, setUnionNameReady] = useState(false);
  const [clubCountReady, setClubCountReady] = useState(false);

  // A route change must retire the prior union's identity before the browser
  // paints the new URL. The two header reads repopulate only this union.
  useLayoutEffect(() => {
    setUnionName(null);
    setClubCount(null);
    setUnionNameReady(false);
    setClubCountReady(false);
  }, [unionId]);

  /**
   * The name and the club count are for the header only. A refusal here is
   * NOT reported as a failure and never blocks the panel: the panel asks the
   * database itself and says what it was told, and a union lead reading a
   * union whose row RLS happens to hide should still get their figures rather
   * than an error about a name.
   */
  useEffect(() => {
    if (!unionId) return;
    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('unions')
          .select('name')
          .eq('id', unionId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          reportError(error, 'UnionDataPage.union_name');
        } else if (data?.name) {
          setUnionName(String(data.name));
        }
      } catch (error) {
        if (!cancelled) reportError(error, 'UnionDataPage.union_name');
      } finally {
        if (!cancelled) setUnionNameReady(true);
      }
    })();

    void (async () => {
      try {
        const { count, error } = await supabase
          .from('union_clubs')
          .select('club_id', { count: 'exact', head: true })
          .eq('union_id', unionId);
        if (cancelled) return;
        if (error) {
          reportError(error, 'UnionDataPage.club_count');
        } else if (typeof count === 'number') {
          setClubCount(count);
        }
      } catch (error) {
        if (!cancelled) reportError(error, 'UnionDataPage.club_count');
      } finally {
        if (!cancelled) setClubCountReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unionId]);

  if (!unionId) {
    return (
      <main className="union-data arena-workspace">
        <ArenaWorkspaceHeader
          area="data"
          title="Union Data"
          summary="Choose A Union To Read Its Verified Production Ledger."
        />
        <PageBar titleAs={false} showHelp={false} title="Union Data" status="No Union">
          <div className="arena-switch arena-ops-keys arena-ops-primary">
            <button
              type="button"
              onClick={() => navigate(canOperateUnionNetwork ? '/unions' : '/community')}
            >
              {canOperateUnionNetwork ? 'Return To Unions' : 'Return To Community'}
            </button>
          </div>
        </PageBar>
      </main>
    );
  }

  return (
    <main className="union-data arena-workspace">
      <ArenaWorkspaceHeader
        area="data"
        title="Union Data"
        context={unionName ? titleCase(unionName) : null}
        summary="What Every Club Beneath This Union Produced In Rake, For The Day, The Week, The Month Or The Year."
      />
      <PageBar
        titleAs={false}
        showHelp={false}
        title="Union Data"
        metrics={[
          {
            label: 'Union',
            value: unionName ? titleCase(unionName) : unionNameReady ? 'Unavailable' : 'Checking',
          },
          { label: 'Clubs', value: clubCount ?? (clubCountReady ? 'Unavailable' : 'Checking') },
        ]}
      >
        <div className="arena-switch arena-ops-keys union-data__keys">
          <button type="button" onClick={() => navigate(`/unions/${unionRef}`)}>
            Union
          </button>
          <button
            type="button"
            className="union-data__primary"
            onClick={() => navigate(`/unions/${unionRef}/statements`)}
          >
            Statements
          </button>
        </div>
      </PageBar>

      {/*
        The union, handed over directly. scopes is union alone: the club scope
        needs a club, and on this page the only honest way to reach one is to
        open it from the list below - which the panel does, and which the
        database re-checks per club.
      */}
      <RakeSnapshotPanel
        clubId={null}
        unionId={unionId}
        userId={user?.id ?? null}
        scopes={['union']}
      />
    </main>
  );
}
