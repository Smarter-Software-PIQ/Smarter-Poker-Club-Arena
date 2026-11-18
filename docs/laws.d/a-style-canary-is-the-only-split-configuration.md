# server/src/engine/aStyleCanaryIsTheOnlySplitConfiguration.law.test.ts

Every Horse runs one effective configuration. There is one recorded exception, and it exists only while a style read option is in `canary`:

- Horses whose stable canary bucket is 0 run the option on.
  - The bucket is sha256 of `style-canary-v1:` plus the lower-cased Horse id, first 32 bits, modulo 10.
- Every other Horse runs the option in shadow.
- No other state of any option, and no other option path, resolves differently for different Horses.
- Only `HorseStyleSwitch.ts` reads the bucket.

Why (2026-11-13): the pre-registered style read evaluation measures a canary, a fixed random tenth of Horses chosen before switch-on, against every other Horse, facing the same opponents in the same period. A per-Horse split anywhere else would be an unrecorded second configuration, which the canary comparison could not tell apart from the option itself.

The test sweeps every non-canary state of every option, plus mixed state sets, and finds exactly one configuration across 400 Horse ids. With each option in canary it finds exactly two configurations, split by the bucket alone. It also scans the server source for any other reader of the bucket.

Strengthened after review 64466c83:

- Golden vectors pin the hash, the salt and the modulus.
- The law pins every option's source default to off, and the worker's single holder over the absent source.
- An anchor case scans every decision-options object the worker builds. The only per-Horse input it may contain is the switch resolver.
- workerRuntime.test.ts adds a behaviour check: two Horses at the same spot, with no option in canary, receive identical decision options.

Strengthened before activation (review f8948093):

- The law test now checks behaviour, not only source text. Over 300 state mixes and 400 Horse ids it compares what the brain receives (`styleSwitchBrainOpts`) per option. Without canary, no option is treated differently for any Horse. With one option in canary, that option is the only one treated differently: on for bucket 0, shadow for every other bucket. No key outside the style options appears.
- workerRuntime.test.ts runs the live worker with one option in canary for a bucket-0 Horse and a bucket-4 Horse. Their decision options differ in that option alone.
