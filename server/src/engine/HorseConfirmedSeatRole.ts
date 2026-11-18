/** Private loader metadata. A symbol survives local seat object spreads without
 * appearing in JSON table frames, stored hand records or player payloads. */
export const confirmedSeatRole = Symbol('confirmed-seat-role');
export function actorRole(value: unknown): 'human' | 'horse' | null {
  return value === false ? 'human' : value === true ? 'horse' : null;
}
export function confirmedHuman(seat: object): boolean {
  return (seat as { [confirmedSeatRole]?: unknown })[confirmedSeatRole] === 'human';
}
