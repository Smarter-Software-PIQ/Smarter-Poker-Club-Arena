import type { CompletedHandObservation } from '../../engine/horseDecision/protocol.js';
import { horseJournalJson, journalHash } from './record.js';

/** Original private producer input, captured inside the immutable atomic request. */
export interface AcceptedTerminalTransport {
  version: 1;
  sourceRelease: string;
  originalLease: string;
  observation: CompletedHandObservation;
  digest: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function captureAcceptedTerminal(
  sourceRelease: string | null,
  originalLease: string | undefined,
  observation: CompletedHandObservation
): AcceptedTerminalTransport | null {
  if (
    !sourceRelease ||
    !/^[0-9a-f]{40}$/.test(sourceRelease) ||
    !originalLease ||
    !uuid.test(originalLease)
  )
    return null;
  const copy = JSON.parse(horseJournalJson(observation)) as CompletedHandObservation;
  const body = { version: 1 as const, sourceRelease, originalLease, observation: copy };
  return { ...body, digest: journalHash(horseJournalJson(body)) };
}

/** Missing legacy provenance stays unknown. Never infer an original source or lease. */
export function readAcceptedTerminal(
  value: unknown,
  expected: { sourceRelease: string | null; tableId: string; handNumber: number; handId: string }
): CompletedHandObservation | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as AcceptedTerminalTransport;
  if (
    t.version !== 1 ||
    !expected.sourceRelease ||
    t.sourceRelease !== expected.sourceRelease ||
    !uuid.test(t.originalLease ?? '')
  )
    return null;
  const o = t.observation;
  if (
    !o ||
    o.generation !== expected.handNumber ||
    o.handKey !== `${expected.tableId}:${expected.handNumber}` ||
    o.committedHandId !== expected.handId ||
    o.fence !== `${expected.tableId}:${expected.handNumber}:${t.originalLease}:observe` ||
    !Array.isArray(o.actions) ||
    !Number.isFinite(o.bigBlind) ||
    o.bigBlind <= 0
  )
    return null;
  if (Object.hasOwn(o, 'terminalOnlySourceRelease') || Object.hasOwn(o, 'acceptedActorRoster'))
    return null;
  try {
    const body = {
      version: t.version,
      sourceRelease: t.sourceRelease,
      originalLease: t.originalLease,
      observation: o,
    };
    if (journalHash(horseJournalJson(body)) !== t.digest) return null;
    return JSON.parse(horseJournalJson(o)) as CompletedHandObservation;
  } catch {
    return null;
  }
}
