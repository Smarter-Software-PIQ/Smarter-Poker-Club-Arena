/** Exact original request identity. This value alone is not durable authority. */
export type TerminalRequestIdentity = Readonly<
  {
    tournamentId: string;
    observedWinnerId: string | null;
  } & (
    | { kind: 'places' }
    | { kind: 'legacy_deal' }
    | { kind: 'proposal_deal'; proposalId: string; revision: string }
    | { kind: 'satellite' }
    | { kind: 'satellite_qualifiers'; qualifierIds: readonly string[] }
  )
>;

export function freezeTerminalRequest<T extends TerminalRequestIdentity>(request: T): Readonly<T> {
  // Copy before freezing so callers cannot mutate
  // the original identity through a retained options/proposal object.
  return Object.freeze({
    ...request,
    ...(request.kind === 'satellite_qualifiers'
      ? { qualifierIds: Object.freeze([...request.qualifierIds]) }
      : {}),
  }) as Readonly<T>;
}
