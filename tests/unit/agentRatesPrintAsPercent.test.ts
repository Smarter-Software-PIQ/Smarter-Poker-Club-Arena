/**
 * AN AGENT'S RATE IS A FRACTION, AND PRINTS AS A PERCENT (2026-11-28)
 *
 * AgentService validates commission_rate as 0 to 0.7, so a 40% agent arrives
 * as 0.4. The Agent Team tree and the club page's agent list printed it with a
 * "%" after it: "0.4%". Every print of a stored rate goes through
 * formatAgentRate; the add-agent form, which holds whole percents and divides
 * by 100 when it saves, is the one place a bare "%" after a rate is right.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatAgentRate } from '../../src/services/AgentService';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('agent rates', () => {
  it('print a stored fraction as a percent', () => {
    expect(formatAgentRate(0.4)).toBe('40.0%');
    expect(formatAgentRate(0.125)).toBe('12.5%');
    expect(formatAgentRate(0)).toBe('0.0%');
    expect(formatAgentRate(0.7)).toBe('70.0%');
  });

  it('are never printed as the raw fraction with a percent sign', () => {
    const offenders: string[] = [];
    for (const file of files('src')) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (
          /\{[\w.?]*(?:commissionRate|RakebackRate|rakebackRate)\}%/.test(line) &&
          !/newAgentForm\./.test(line)
        )
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
