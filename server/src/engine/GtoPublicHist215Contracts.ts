/**
 * The public215 feature contracts, selected ONLY by a dataset's explicit
 * feature_contract_version (never inferred from a vector, model or template).
 *
 * v1 (holdem-public-hist215-v1, R7): 215 features, descriptor 0ca054f9...
 * v2 (holdem-public-hist215-v2, R8): the unchanged v1 215 features followed by
 *    PUBLIC_HIST215_V2_APPENDED one-hots (246 total), descriptor c37e7aa2...
 * v3 (holdem-public-hist215-v3, V31 cell contract v3, 2026-11-13, dormant): the
 *    unchanged v2 246 features followed by PUBLIC_HIST215_V3_APPENDED (the
 *    overbet facing bucket and the 'donk' role; 248 total), descriptor 26d9271d...
 * Every v1 feature keeps its index and meaning, so v1 encodes byte-identically;
 * every v2 feature keeps its index too, so v2 also encodes byte-identically.
 */
export const PUBLIC_HIST215_V1 = 'holdem-public-hist215-v1' as const;
export const PUBLIC_HIST215_V2 = 'holdem-public-hist215-v2' as const;
export const PUBLIC_HIST215_V3 = 'holdem-public-hist215-v3' as const;
export type Public215FeatureContractVersion =
  | typeof PUBLIC_HIST215_V1
  | typeof PUBLIC_HIST215_V2
  | typeof PUBLIC_HIST215_V3;
export const PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256 =
  '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f';
export const PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256 =
  'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4';
/** World Hub public_hist215.FEATURE_DESCRIPTOR_V3_SHA256 pins the same digest. */
export const PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256 =
  '26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784';
export interface Public215FeatureContract {
  readonly version: Public215FeatureContractVersion;
  readonly schemaSha256: string;
  readonly featureCount: number;
}
const CONTRACTS: readonly Public215FeatureContract[] = Object.freeze([
  Object.freeze({
    version: PUBLIC_HIST215_V1,
    schemaSha256: PUBLIC_HIST215_V1_FEATURE_SCHEMA_SHA256,
    featureCount: 215,
  }),
  Object.freeze({
    version: PUBLIC_HIST215_V2,
    schemaSha256: PUBLIC_HIST215_V2_FEATURE_SCHEMA_SHA256,
    featureCount: 246,
  }),
  Object.freeze({
    version: PUBLIC_HIST215_V3,
    schemaSha256: PUBLIC_HIST215_V3_FEATURE_SCHEMA_SHA256,
    featureCount: 248,
  }),
]);
/** The contract a dataset declares; null for any other value. */
export function public215FeatureContract(version: unknown): Public215FeatureContract | null {
  return CONTRACTS.find((c) => c.version === version) ?? null;
}
/** The contract a pinned descriptor checksum belongs to; null when unknown. */
export function public215FeatureContractBySchema(
  schemaSha256: unknown
): Public215FeatureContract | null {
  return CONTRACTS.find((c) => c.schemaSha256 === schemaSha256) ?? null;
}
/** True when some contract's input width is `columns` (215, 246 or 248). */
export function isPublic215FeatureCount(columns: unknown): boolean {
  return CONTRACTS.some((c) => c.featureCount === columns);
}
export function isPublic215FeatureContractVersion(
  version: unknown
): version is Public215FeatureContractVersion {
  return public215FeatureContract(version) !== null;
}
