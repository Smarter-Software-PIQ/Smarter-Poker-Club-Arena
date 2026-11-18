import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openState } from './state.mjs';
import { createIntake, CODEX, TOPIC } from './core.mjs';
const execute = promisify(execFile);
export function createPlugin({
  clientFactory = createClient,
  executeCommand = execute,
  statPath = stat,
  stateFactory = openState,
} = {}) {
  return {
    id: 'production-alerts-native-wakeup',
    name: 'Production Alerts Native Wakeup',
    register(api) {
      let intake;
      let channelStatus = 'not_started';
      let lifecycle = 'not_started';
      let generation = 0;
      let closeRecoveries = 0;
      let closeRecoveryAttempts = 0;
      let startTask;
      let stopTask;
      let replacementTask;
      let stopping = false;
      api.registerGatewayMethod('production-alerts-native-wakeup.status', ({ respond }) => {
        respond(true, {
          lifecycle,
          serviceActive: lifecycle === 'active',
          generation,
          closeRecoveries,
          closeRecoveryAttempts,
          channelStatus,
          ...(intake?.status() ?? { state: 'not_started' }),
        });
      });
      api.registerService({
        id: 'production-alerts-native-wakeup',
        async start() {
          if (this.starting || this.store) throw new Error('native intake service already started');
          if (stopping) throw new Error('native intake service stopping');
          const currentGeneration = ++generation;
          lifecycle = 'starting';
          channelStatus = 'not_started';
          closeRecoveries = 0;
          closeRecoveryAttempts = 0;
          this.starting = true;
          startTask = (async () => {
            try {
              const { publishableKey, stateDirectory } = api.pluginConfig ?? {};
              const directory = resolve(stateDirectory ?? '');
              if (
                !directory.startsWith('/Volumes/SmarterWork/agent-work/') ||
                typeof publishableKey !== 'string' ||
                (!publishableKey.startsWith('sb_publishable_') && !publishableKey.startsWith('eyJ'))
              )
                throw new Error('native wake configuration invalid');
              // Keys must be public client keys. Never accept privileged JWTs.
              if (publishableKey.startsWith('eyJ')) {
                let claims;
                try {
                  claims = JSON.parse(
                    Buffer.from(publishableKey.split('.')[1], 'base64url').toString()
                  );
                } catch {
                  throw new Error('invalid public key');
                }
                if (claims.role !== 'anon')
                  throw new Error('only receive-only public client keys are supported');
              }
              // The journal must live on the external work volume, never on the
              // startup disk. Measure the state directory itself: macOS can leave
              // /Volumes/SmarterWork as a startup-disk folder (with the work volume
              // mounted below it or as "SmarterWork 1") after a disconnect, and a
              // check on that folder alone refused a correctly mounted journal.
              if ((await statPath(directory)).dev === (await statPath('/')).dev)
                throw new Error('external work volume is not mounted');
              const { stdout: capabilityOutput } = await executeCommand(
                '/usr/bin/security',
                [
                  'find-generic-password',
                  '-s',
                  'Smarter.Poker Production Alerts Receive v1',
                  '-a',
                  'production-alerts-native-wakeup',
                  '-w',
                ],
                { timeout: 5_000, maxBuffer: 4096, encoding: 'utf8', shell: false }
              );
              const capability = capabilityOutput.trim();
              if (!/^[0-9a-f]{64}$/.test(capability))
                throw new Error('native receive credential unavailable');
              const channelName = TOPIC + ':' + capability;
              const client = clientFactory(
                'https://kuklfnapbkmacvwxktbh.supabase.co',
                publishableKey,
                {
                  auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false,
                  },
                  global: {
                    fetch: (url, options) =>
                      fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }),
                  },
                }
              );
              this.client = client;
              const store = await stateFactory(directory);
              this.store = store;
              intake = createIntake({
                load: store.load,
                save: store.save,
                async pending(ids) {
                  const { data, error } = await client.rpc('fn_ca_native_alert_pending', {
                    p_active: ids,
                    p_channel: channelName,
                  });
                  if (error) throw new Error('opaque pending read unavailable');
                  return data;
                },
                async queue(args) {
                  const { stdout } = await executeCommand(CODEX, args, {
                    timeout: 30_000,
                    maxBuffer: 16_384,
                    encoding: 'utf8',
                    shell: false,
                  });
                  return stdout;
                },
                async wake(args) {
                  await executeCommand('/usr/bin/open', args, {
                    timeout: 10_000,
                    maxBuffer: 4096,
                    encoding: 'utf8',
                    shell: false,
                  });
                },
              });
              const current = () => !stopping && generation === currentGeneration;
              const onEvent = (recoveryChannel) => {
                if (!current()) return;
                void intake
                  .event()
                  .then(() => {
                    // Only a live joined channel AND a successful original pending
                    // read complete this disconnection episode. Stale callbacks or
                    // an immediate close cannot replenish the finite attempt.
                    if (
                      current() &&
                      recoveryChannel === this.channel &&
                      channelStatus === 'SUBSCRIBED'
                    )
                      closeRecoveryAttempts = 0;
                  })
                  .catch(() =>
                    api.logger.error(
                      'Production Alerts intake unavailable; retained state requires inspection'
                    )
                  );
              };
              const subscribe = () => {
                if (!current()) return;
                const channel = client.channel(channelName, { config: { private: true } });
                this.channel = channel;
                channel
                  .on('broadcast', { event: 'inbox_committed' }, () => onEvent(channel))
                  .on('broadcast', { event: 'intake_acknowledged' }, () => onEvent(channel))
                  .subscribe((status) => {
                    if (!current() || this.channel !== channel) return;
                    channelStatus = status;
                    if (status === 'SUBSCRIBED') {
                      lifecycle = 'active';
                      onEvent(channel);
                    } else if (status === 'CLOSED') {
                      // The SDK removes a closed channel; its socket reconnect cannot
                      // rejoin it. One explicit close event owns one replacement.
                      lifecycle = 'degraded';
                      if (closeRecoveryAttempts === 0) {
                        closeRecoveries += 1;
                        closeRecoveryAttempts += 1;
                        replacementTask = Promise.resolve()
                          .then(() => {
                            // CLOSED already removed this channel in the SDK. Sending
                            // another leave would wait for an acknowledgement that cannot arrive.
                            if (current()) subscribe();
                          })
                          .catch(() => {
                            if (current()) lifecycle = 'degraded';
                            api.logger.error('Production Alerts channel replacement unavailable');
                          });
                      }
                      api.logger.error('Production Alerts event channel CLOSED');
                    } else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
                      lifecycle = 'degraded';
                      api.logger.error(`Production Alerts event channel ${status}`);
                    }
                  });
              };
              subscribe();
            } catch (error) {
              if (generation === currentGeneration) generation += 1;
              lifecycle = 'start_failed';
              channelStatus = 'start_failed';
              try {
                await this.client?.removeAllChannels();
              } finally {
                await intake?.settled();
                this.store?.close();
                this.store = null;
                this.channel = null;
                this.client = null;
              }
              throw error;
            } finally {
              this.starting = false;
            }
          })();
          return startTask;
        },
        async stop() {
          if (stopping) return stopTask;
          stopping = true;
          stopTask = (async () => {
            lifecycle = 'stopping';
            generation += 1;
            await startTask?.catch(() => {});
            await replacementTask?.catch(() => {});
            try {
              await this.client?.removeAllChannels();
            } finally {
              await intake?.settled();
              this.store?.close();
              this.store = null;
              this.channel = null;
              this.client = null;
              channelStatus = 'stopped';
              lifecycle = 'stopped';
              stopping = false;
            }
          })();
          return stopTask;
        },
      });
    },
  };
}
export default createPlugin();
