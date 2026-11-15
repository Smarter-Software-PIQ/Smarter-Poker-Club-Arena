import { supabase } from '../lib/supabase';
import { isUUID } from '../utils/clubIdResolver';
import type { LightningAnchorSeat, LightningMySession } from './lightningSession';

/** The original verified binding survives a reload after the pool has closed. */
export function rememberLightningLeaveAnchor(
  userId: string,
  room: string,
  anchor: { tableId: string; occupancyId: string }
) {
  try {
    window.sessionStorage.setItem(
      'ca:lightning-leave-anchor:' + userId + '/' + room,
      JSON.stringify(anchor)
    );
  } catch {
    /* The mounted page also retains the binding. */
  }
}

export function rememberedLightningLeaveAnchor(
  userId: string,
  room: string
): { tableId: string; occupancyId: string } | null {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem('ca:lightning-leave-anchor:' + userId + '/' + room) ?? 'null'
    );
    return value && isUUID(value.tableId) && isUUID(value.occupancyId) ? value : null;
  } catch {
    return null;
  }
}

/** Stop Playing can close an idle pool before its anchor has cashed out. */
export async function fetchStoppedLightningAnchor(
  session: LightningMySession,
  userId: string,
  room: { clusterId: string; poolSessionId: string },
  expected: { tableId: string; occupancyId: string } | null
): Promise<LightningAnchorSeat | null> {
  if (!expected) {
    if (!session.seatTableId) return null;
    throw new Error('Lightning Leave Anchor Unverified');
  }
  const { data, error } = await supabase.rpc('fn_lightning_stopped_leave_anchor', {
    p_cluster_id: room.clusterId,
    p_pool_session_id: room.poolSessionId,
    p_occupancy_id: expected.occupancyId,
  });
  if (error) throw error;
  if (!data) return null;
  if (
    data.table_id !== expected.tableId ||
    data.user_id !== userId ||
    !Number.isInteger(data.seat_number) ||
    data.seat_number < 1 ||
    data.left_at !== null ||
    data.occupancy_id !== expected.occupancyId ||
    typeof data.occupancy_id !== 'string' ||
    !isUUID(data.occupancy_id)
  )
    throw new Error('Lightning Leave Anchor Unverified');
  return {
    anchorTableId: data.table_id,
    seatNumber: data.seat_number,
    occupancyId: data.occupancy_id,
  };
}
