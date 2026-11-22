/**
 * THE SERVING ENGINE PUBLISHES WHAT ITS SWITCH REGISTERS (2026-11-18, Horse Switch lane, SAFETY).
 *
 * THE RESET TRAP. A switch row (even 'off') for an option the SERVING engine does not register made that engine's
 * parser reject the whole configuration (HorseOptionSwitch.ts optionSwitchStatesFrom): every switched non-style
 * option then ran at its release default. Since 2026-11-20 the parser skips a row for a name it does not know at
 * all and keeps the rest (the alarm still fires); a state the serving engine does not support for a name it does
 * register still voids the set, so this guard stays. The database cannot see this on its own: fn_ca_horse_option_switch_set
 * checks the database whitelist, which is written from main and can be AHEAD of the release that is serving (a
 * follow-up migration installed before the engine that registers its options is deployed, or a rollback).
 *
 * THE GUARD, ENGINE HALF. At boot and on every switch read (the delivery tick, STYLE_SWITCH_DELIVERY_MS) the main
 * thread publishes the names it registers and the states each supports, keyed by its release sha, through
 * fn_ca_horse_option_registry_publish (service role, the same client the switch read uses). The database half
 * (migration *_the_horse_option_switch_refuses_what_the_serving_engine_does_not_register.sql) makes
 * fn_ca_horse_option_switch_set and fn_ca_horse_option_switch_record_evidence refuse a name or state that a fresh
 * published registry does not list.
 *
 * MEASUREMENT AND GUARD ONLY. Nothing here reads or changes a decision, the switch configuration or what the
 * workers receive; a failed publish never fails the switch read (it is not awaited by it) and never throws.
 * A process without a provable release sha (ENGINE_RELEASE_IDENTITY.releaseSha null: a local or test build)
 * publishes nothing, so it can never stand in for the serving release.
 */
import { createHash } from 'node:crypto';
import { OPTION_SWITCH_REGISTRY } from '../HorseOptionSwitch.js';

/** The published registry: option name -> the states this release supports for it, in registry order. */
export type OptionRegistryPayload = Readonly<Record<string, readonly string[]>>;

export function optionRegistryPayload(
  entries: readonly { name: string; states: readonly string[] }[] = OPTION_SWITCH_REGISTRY
): OptionRegistryPayload {
  const out: Record<string, readonly string[]> = {};
  for (const e of entries) out[e.name] = Object.freeze([...e.states]);
  return Object.freeze(out);
}

/** sha256 of the payload's canonical JSON (keys sorted, states as listed): the database stores it with the row. */
export function optionRegistryDigest(payload: OptionRegistryPayload): string {
  const canonical = JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((k) => [k, payload[k]])
  );
  return createHash('sha256').update(canonical).digest('hex');
}

type PublishRpc = (
  fn: 'fn_ca_horse_option_registry_publish',
  args: { p_release_sha: string; p_registry: OptionRegistryPayload; p_digest: string }
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

export type OptionRegistryPublishOutcome =
  | 'published'
  | 'skipped_no_release'
  | 'function_missing'
  | 'failed';

export interface OptionRegistryPublisherDeps {
  /** The full 40-hex release sha, or null when the process cannot prove one. */
  releaseSha: string | null;
  rpc: PublishRpc;
  payload?: OptionRegistryPayload;
  now?: () => number;
  warn?: (message: string) => void;
}

const WARN_EVERY_MS = 30 * 60_000;
const missing = (error: { message?: string; code?: string }): boolean =>
  error.code === 'PGRST202' ||
  error.code === '42883' ||
  /could not find the function|function .* does not exist/i.test(error.message ?? '');

/** publish() never throws and never rejects; one publish at a time (a tick that finds one in flight skips). */
export function createOptionRegistryPublisher(deps: OptionRegistryPublisherDeps): {
  publish(): Promise<OptionRegistryPublishOutcome>;
} {
  const payload = deps.payload ?? optionRegistryPayload();
  const digest = optionRegistryDigest(payload);
  const now = deps.now ?? (() => Date.now());
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const sha = /^[0-9a-f]{40}$/.test(deps.releaseSha ?? '') ? deps.releaseSha! : null;
  let inFlight: Promise<OptionRegistryPublishOutcome> | null = null;
  let lastWarn = Number.NEGATIVE_INFINITY;
  let warnedNoRelease = false;
  const say = (message: string): void => {
    const at = now();
    if (at - lastWarn < WARN_EVERY_MS) return;
    lastWarn = at;
    warn(message);
  };
  const once = async (): Promise<OptionRegistryPublishOutcome> => {
    if (!sha) {
      if (!warnedNoRelease) {
        warnedNoRelease = true;
        warn(
          '[HorseOptionRegistry] no full release sha: this process does not publish its option registry'
        );
      }
      return 'skipped_no_release';
    }
    try {
      const { error } = await deps.rpc('fn_ca_horse_option_registry_publish', {
        p_release_sha: sha,
        p_registry: payload,
        p_digest: digest,
      });
      if (!error) return 'published';
      if (missing(error)) {
        say(
          '[HorseOptionRegistry] fn_ca_horse_option_registry_publish is not installed: the switch guard is not active yet'
        );
        return 'function_missing';
      }
      say(
        `[HorseOptionRegistry] publish failed: ${error.message ?? error.code ?? 'unknown error'}`
      );
      return 'failed';
    } catch (error) {
      say(
        `[HorseOptionRegistry] publish failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return 'failed';
    }
  };
  return {
    publish(): Promise<OptionRegistryPublishOutcome> {
      if (inFlight) return inFlight;
      inFlight = once().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

let productionPublisher: ReturnType<typeof createOptionRegistryPublisher> | null = null;

/** The production publish: the service-role client and the image's release identity, imported lazily. */
export async function publishOptionRegistryToDatabase(): Promise<OptionRegistryPublishOutcome> {
  try {
    if (!productionPublisher) {
      const [{ supabase }, { ENGINE_RELEASE_IDENTITY }] = await Promise.all([
        import('../../services/supabase/client.js'),
        import('../../releaseIdentity.js'),
      ]);
      productionPublisher = createOptionRegistryPublisher({
        releaseSha: ENGINE_RELEASE_IDENTITY.releaseSha,
        rpc: (fn, args) => supabase.rpc(fn, args),
      });
    }
    return await productionPublisher.publish();
  } catch {
    return 'failed';
  }
}
