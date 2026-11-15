import { supabase } from '../services/supabase/client.js';

export interface LightningSitOutChanged {
  type: 'lightning_sitout_changed';
  pool_session_id: string;
  player_id: string;
  occupancy_id: string;
  sitting_out: boolean;
  sit_out_at: string | null;
  blind_off?: boolean;
}
export interface SitOutReceipt {
  seat: Record<string, unknown>;
  pool_session_id: string | null;
  cluster_id: string | null;
  sitting_out: boolean;
  blind_off: boolean;
  hands_remaining: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The original explicit transition owns its transaction and publication. */
export class SeatSitOutPersistence {
  private readonly pending = new Map<string, Promise<SitOutReceipt | null>>();
  constructor(private readonly emit: (room: string, event: LightningSitOutChanged) => void) {}

  wait(tableId: string, playerId: string, occupancyId: string): Promise<SitOutReceipt | null> {
    return this.pending.get(`${tableId}:${playerId}:${occupancyId}`) ?? Promise.resolve(null);
  }

  persist(
    tableId: string,
    playerId: string,
    occupancyId: string,
    sittingOut: boolean
  ): Promise<SitOutReceipt | null> {
    const key = `${tableId}:${playerId}:${occupancyId}`;
    const prior = this.pending.get(key) ?? Promise.resolve();
    const current = prior
      .catch(() => undefined)
      .then(async () => {
        const { data, error } = await supabase.rpc('fn_cash_seat_sitout', {
          p_table_id: tableId,
          p_user_id: playerId,
          p_occupancy_id: occupancyId,
          p_sitting_out: sittingOut,
        });
        if (error) throw new Error(`Persist sit-out failed: ${error.message}`);
        if (data === null) return null;
        const result = data as SitOutReceipt;
        const seat = result.seat;
        if (
          !Number.isInteger(result.hands_remaining) ||
          result.hands_remaining < 0 ||
          !seat ||
          seat.table_id !== tableId ||
          seat.user_id !== playerId ||
          seat.occupancy_id !== occupancyId ||
          seat.left_at !== null ||
          seat.leave_pending === true ||
          result.sitting_out !== sittingOut ||
          typeof result.blind_off !== 'boolean' ||
          seat.is_sitting_out !== (sittingOut && !result.blind_off)
        )
          throw new Error('Sit-out transaction returned an unverified occupancy');
        if (result.pool_session_id !== null) {
          if (
            !uuid.test(result.pool_session_id) ||
            !uuid.test(occupancyId) ||
            typeof result.cluster_id !== 'string' ||
            !uuid.test(result.cluster_id)
          )
            throw new Error('Sit-out room identity unverified');
          const stamp = result.blind_off ? null : seat.sit_out_at;
          if (
            sittingOut && !result.blind_off
              ? typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))
              : stamp !== null
          )
            throw new Error('Sit-out clock unverified');
          this.emit(result.pool_session_id, {
            type: 'lightning_sitout_changed',
            pool_session_id: result.pool_session_id,
            player_id: playerId,
            occupancy_id: occupancyId,
            sitting_out: sittingOut,
            sit_out_at: stamp as string | null,
            ...(result.blind_off ? { blind_off: true } : {}),
          });
        }
        return result;
      });
    this.pending.set(key, current);
    const cleanup = () => {
      if (this.pending.get(key) === current) this.pending.delete(key);
    };
    void current.then(cleanup, cleanup);
    return current;
  }
}
