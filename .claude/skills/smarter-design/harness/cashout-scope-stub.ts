/* The harness has no cashout account epoch, so every money screen read
   "Unavailable". The real hook returns a guard function; this one returns the
   SAME function every render. A fresh `() => true` per render would be a new
   effect dependency each time and the page would re-render forever. */
const always = () => true;
export function useCashoutScope(_accountId: string | undefined, _view: string): () => boolean {
  return always;
}
export function useCashoutScopeKey(accountId: string | undefined, view: string): string {
  return `${accountId ?? ''}:${view}`;
}
