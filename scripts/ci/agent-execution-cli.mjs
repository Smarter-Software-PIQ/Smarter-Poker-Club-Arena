import { readFileSync } from 'node:fs';
import { inputFingerprint, reusableEvidence, readProviderEvidence, updateOperation, failureDisposition, summarizeMetrics } from './agent-execution.mjs';
// Every action is an explicit invocation. No subprocess executes a release.
const [command, file] = process.argv.slice(2);
try {
  if (!file || process.argv.length !== 4) throw Error('Usage: agent-execution-cli.mjs fingerprint|evidence|operation|failure|metrics INPUT_JSON');
  const input = JSON.parse(readFileSync(file, 'utf8'));
  let result;
  switch (command) {
    case 'fingerprint': result = { fingerprint: inputFingerprint(process.cwd(), input) }; break;
    case 'evidence': result = reusableEvidence(input.receipt, input.expected,
      input.expected.authority === 'github' ? readProviderEvidence(input.expected, input.receipt) : undefined); break;
    case 'operation': result = updateOperation(input.directory, input.event); break;
    case 'failure': result = failureDisposition(input); break;
    case 'metrics': result = summarizeMetrics(input); break;
    default: throw Error('Unknown execution command');
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Execution request refused: ${error.message}`);
  process.exitCode = 1;
}
