export interface ObservedHandReceipt {
  table_id: string;
  hand_number: number;
  viewer_id: string;
}

/** A replay entitlement requires one authenticated connection for the entire deal. */
export class ObservedHands<T extends { userId?: string }> {
  private active = new Map<string, { number: number; peers: Set<T> }>();
  private finished = new Map<string, Map<number, string[]>>();

  start(table: string, number: number, peers: Iterable<T>): void {
    if (!Number.isSafeInteger(number) || number <= 0) return;
    this.active.set(table, { number, peers: new Set(Array.from(peers).filter((p) => p.userId)) });
  }
  missed(table: string, peer: T): void {
    this.active.get(table)?.peers.delete(peer);
  }
  leave(peer: T, table?: string): void {
    if (table) this.missed(table, peer);
    else for (const deal of this.active.values()) deal.peers.delete(peer);
  }
  finish(table: string, number: number): void {
    const deal = this.active.get(table);
    if (!deal || deal.number !== number) return;
    const hands = this.finished.get(table) ?? new Map<number, string[]>();
    hands.set(number, [
      ...new Set(Array.from(deal.peers).flatMap((p) => (p.userId ? [p.userId] : []))),
    ]);
    // The settlement owner supplies the immutable archive id after commit.
    // Keep every outstanding completion until that original operation arrives;
    // an arbitrary hand-count cap would silently discard watched hands.
    this.finished.set(table, hands);
    this.active.delete(table);
  }
  receipts(table: string, number: number): ObservedHandReceipt[] {
    return (this.finished.get(table)?.get(number) ?? []).map((viewer_id) => ({
      table_id: table,
      hand_number: number,
      viewer_id,
    }));
  }
  take(table: string, number: number): string[] {
    const hands = this.finished.get(table);
    const users = hands?.get(number) ?? [];
    hands?.delete(number);
    if (!hands?.size) this.finished.delete(table);
    return users;
  }
  clear(table: string): void {
    this.active.delete(table);
    this.finished.delete(table);
  }
}
