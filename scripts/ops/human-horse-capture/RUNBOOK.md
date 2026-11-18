# Capture toolkit v3 (v2 + 2026-11-15 additions at the end) (for the next declared capture; the 533608409f read used observation-53360840-20261114/tools, unchanged)
Changes from v1, all tested 2026-11-14 (see TESTS.md): source and reader image are parameters (HVH_SHA, HVH_IMAGE; nothing hard-coded); any window length up to 48 h, cut into 2-hour segments (segments.py); faced-wager origins are a pipeline step (post_capture.py origins) so the packet is right the first time; roll-up sample 3,000 hands in batches of 1,200 keys (each inside the 1,300 s reader limit); rollup_aggregate sums batches.
Frozen method is NOT part of the toolkit and is not changed: TIGHT-MANIAC-METHOD-v1.md digest af0bd14cbae3d66a.
Order (one writer, each output once; calls under 60 s, long steps with nohup and a reminder):
0. New folder observation-<sha8>-<date>/ with DECLARATION.json (source, instance, interval) posted to the inbox BEFORE any read. Retain a reader image for that source: docker tag <engine image> hvh-reader:<sha10>.
1. After the window: HVH_SHA=<sha> nohup bash run-capture-steps.sh <obs>/capture START END
2. HVH_SHA=<sha> python3 post_capture.py batches <obs>/capture
3. cp run-originals.sh <obs>/capture/; HVH_SHA=<sha> HVH_IMAGE=hvh-reader:<sha10> nohup bash <obs>/capture/run-originals.sh > <obs>/capture/originals.log
4. post_capture.py priors <witness.jsonl> <obs>/tight-maniac-priors.json; post_capture.py origins <witness.jsonl> <obs>/tight-maniac-faced-origins.json
5. build_packet.py <witness.jsonl> <priors> <obs>/tight-maniac <instance> <origins>
6. post_capture.py fires START END ...; post_capture.py cohort START END ...; rollup_aggregate.py rows-1,rows-2,rows-3 cohort.json per-horse-feature-rollup.json
7. Report, evidence index with digests, tracker rows CAP and PLAY only, inbox, checkpoints. Never mix builds; if a cutover lands inside the window, shorten to the last full minute before it.

Originals-first order (used when the overwatch holds database-heavy reads until STEADY, as for the 06d45e7d cutover):
a. Write <obs>/capture/BOUNDARY.json. b. HVH_SHA=<sha> post_capture.py keys_light START END <obs>/capture/human-hand-keys.json
c. Witness batches only: build witness-batch-1.mjs from those keys (post_capture.py batches needs the census hands file, so in this order make the witness batch with keys_batch below) and run run-originals.sh (it runs witness first). d. After STEADY: run-capture-steps.sh, then reconcile the census human set with human-hand-keys.json; read any census-only hand still in the journal into originals-witness-2.jsonl; then exports, roll-up and the rest.

## Host-side originals (added 2026-11-15T00:01:44Z by session 01Gw7aDs; replaces step 3's ssh-bound run for every batch)
Why: run-originals.sh receives no bytes over ssh until a batch ends; on 06d45e7d a witness batch and a roll-up batch lost their idle connection and their output. The reader, its limits and the method are unchanged; only where the process runs changes.
3'. HVH_SHA=<sha> HVH_IMAGE=hvh-reader:<sha10> bash run-originals-host.sh start <obs>/capture /root/hvh-work-<sha8>   (copies every witness, export and roll-up batch, starts one sequential detached runner on ca-engine, returns at once)
    bash run-originals-host.sh status <obs>/capture /root/hvh-work-<sha8>      (poll; about 9.5 minutes per 1,200 roll-up keys)
    bash run-originals-host.sh collect <obs>/capture /root/hvh-work-<sha8>     (copies finished outputs back, sha256 verified against the host file, read-only; never overwrites)
Long Mac-side steps (run-capture-steps.sh) must be started with: nohup perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' bash ... &   (plain nohup jobs are ended by the host connector).
After the census: reconcile the census human set with the keys used (observation-06d45e7d-20261114/capture/reconcile.py).

## One named operator per capture (added 2026-11-15T00:24:44Z by session 01Gw7aDs)
Every reading step needs HVH_OPERATOR=<operator session id>. The first call creates <capture>/.operation.lock (atomic mkdir, OPERATOR file); every other caller is refused with exit 7 before any read. The host runner takes the same lock in its ca-engine work folder. Refusing to overwrite outputs is not enough: two operators could otherwise run concurrent reads into different files.
Run lock (added 2026-11-15T00:42:04Z): every reading step also takes <capture>/.run.lock (atomic mkdir; pid, host, step, operator, start) and releases it on exit. A second invocation while one runs is refused with exit 8, also for the same operator. A lock left by an interrupted step is never taken over automatically: inspect that step's outputs, then mv .run.lock .run.lock.stale-<UTC>. The host runner additionally refuses a second start while its runner.sh exists.

## v3 (2026-11-15, session 01Gw7aDs): times, preservation, resume, near-tight
- Times: give every time as ISO UTC; only window.py turns them into epochs. Effective window: window.py boundary ENGINE_START ANNOUNCEMENT.
- Declare + preserve in one step, at the custodian's SEALED line: HVH_OPERATOR=<op> HVH_SHA=<40hex> preserve-host.sh start <sha8> <first-minute ISO> <provisional END ISO, at most 48 h>
  It also retains the reader image hvh-reader:<sha10> (an engine image can be pruned within hours: 54c9aac8's was). At the BOUNDARY line: preserve-host.sh close <sha8> <END ISO + 7 min>. status/stop as needed.
- Census: rerun the same run-capture-steps.sh command to resume; complete segments are kept, incomplete ones are renamed attempt<k>-incomplete-* and rerun once.
- Report only: near_tight.py <obs> <out.json> lists tight-by-method witnesses above the engine's tight line and, from 7e8688d3 on, the engine's base vs final preflop thresholds (decision.preflopReadReceipt) per decision.
- Read support lanes (Fixed-Limit, Lightning) inside the live journal's retention: a read 13 h after the window start lost 19 of 520 early hands (support-fixed-limit/README).
- Reserved paths (never clean up while a capture is open): /Volumes/SmarterWork/agent-work/extreme-capacity/human-horse-completion-01a1cbbc/source (census source), ca-engine /root/hvh-work-*, /var/lib/club-arena/hvh-preserve-*, docker tags hvh-reader:*.
