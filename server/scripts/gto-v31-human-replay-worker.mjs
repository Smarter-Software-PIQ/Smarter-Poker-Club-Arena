import {isMainThread} from 'node:worker_threads';
import {runFiniteEvaluationWorker} from './finite-evaluation-worker.mjs';
/** V31 human replay launcher: one finite offline worker (public215 cells answer only off the main thread). */
if(!isMainThread)throw Error('OFFLINE_EVALUATION_LAUNCHER_MAIN_THREAD_REQUIRED');
const outcome=await runFiniteEvaluationWorker(new URL('../src/scripts/gtoV31HumanReplay.ts',import.meta.url),process.argv.slice(2));
if(outcome.error)console.error('[gto-v31-human-replay-worker] failed:',outcome.error);
process.exitCode=outcome.exitCode;
