/**
 * The room page's half of a timed Lightning join (lightningJoinTiming.ts):
 * the room mounted, its socket connected, its first snapshot (the player is in
 * the pool), and its first hand. The painted mark is recorded where the room
 * already sends its RENDER_ACK. Telemetry only; a room that no join was bound
 * to (or claimed by) records nothing.
 */
import { useEffect } from 'react';
import { lightningHandId, type LightningSnapshotFields } from './lightningHand';
import { markLightningJoinRoom } from './lightningJoinTiming';

export function useLightningJoinTiming(input: {
  roomId: string | null | undefined;
  lightningRoom: boolean;
  connected: boolean;
  snapshot: LightningSnapshotFields | null | undefined;
}): void {
  const { roomId, lightningRoom, connected } = input;
  const room = lightningRoom && roomId ? roomId : null;
  const hasSnapshot = input.snapshot != null;
  const handId = room ? lightningHandId(input.snapshot) : null;
  useEffect(() => {
    if (room) markLightningJoinRoom(room, 'room_open');
  }, [room]);
  useEffect(() => {
    if (room && connected) markLightningJoinRoom(room, 'socket_connected');
  }, [room, connected]);
  useEffect(() => {
    if (room && hasSnapshot) markLightningJoinRoom(room, 'first_snapshot');
  }, [room, hasSnapshot]);
  useEffect(() => {
    if (room && handId) markLightningJoinRoom(room, 'first_hand');
  }, [room, handId]);
}
