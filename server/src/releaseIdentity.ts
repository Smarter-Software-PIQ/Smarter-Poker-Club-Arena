export type ReleaseIdentity = {
  /** Backward-compatible display and database identity. */
  version: string;
  /** Exact immutable build identity. Null means the process cannot prove one. */
  releaseSha: string | null;
};

type ReleaseIdentityEnvironment = Readonly<{
  GIT_COMMIT_SHA?: string | undefined;
  ENGINE_VERSION?: string | undefined;
}>;

/**
 * Resolve release identity once from the image environment. A shortened SHA is
 * useful copy, but it is never sufficient release authority: only a complete
 * lowercase commit can drive exact provenance, dedupe, or deployment proof.
 */
export function resolveReleaseIdentity(
  env: ReleaseIdentityEnvironment = {
    GIT_COMMIT_SHA: process.env.GIT_COMMIT_SHA,
    ENGINE_VERSION: process.env.ENGINE_VERSION,
  }
): ReleaseIdentity {
  const candidate = env.GIT_COMMIT_SHA?.trim().toLowerCase() ?? '';
  if (/^[0-9a-f]{40}$/.test(candidate)) {
    return { version: candidate.slice(0, 8), releaseSha: candidate };
  }

  return {
    version: env.ENGINE_VERSION?.trim() || 'local',
    releaseSha: null,
  };
}

export const ENGINE_RELEASE_IDENTITY = resolveReleaseIdentity();

/**
 * The engine_build key of a hand row (hand_history.engine_build, migration
 * 20261118073245): the exact build of the process that played and committed
 * the hand. Every engine path that builds a hand row spreads this into it -
 * logHandHistory for cash and tournament tables, LightningHandHost.handRow for
 * Lightning - so no hand format can be left unstamped by a writer that forgot
 * (aHandNamesTheEngineBuildThatDealtIt.law.test.ts). Only a full 40-hex
 * GIT_COMMIT_SHA is release authority; otherwise the key is omitted and the
 * column stays NULL. Resolved per call so the row reflects the environment
 * the hand was committed under.
 */
export function handRowEngineBuild(env?: ReleaseIdentityEnvironment): { engine_build?: string } {
  const sha = resolveReleaseIdentity(env).releaseSha;
  return sha ? { engine_build: sha } : {};
}
