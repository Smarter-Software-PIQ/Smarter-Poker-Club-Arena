/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AN AGENT CANNOT LOCK THE MAC OUT OF PRODUCTION (2026-11-08)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * On 2026-11-07 at about 22:00 Chicago an agent on the Ops Mac tried to log
 * in to the engine host (engine-01, 5.161.252.33) and failed. The host's
 * fail2ban jail (aggressive sshd, 4 retries, 24 h ban - installed after the
 * 2026-08-15 compromise) then banned the Mac's address for a day. Every agent
 * on that Mac lost read access to production at once.
 *
 * One ssh call can spend several attempts: every key in the ssh-agent, every
 * default identity, then password and keyboard prompts. The fix is that every
 * connection to the engine or the Backup host (5.161.236.0) is FAIL-CLOSED:
 * non-interactive (BatchMode=yes), exactly the one pinned key
 * (-i <key> + IdentitiesOnly=yes), and a ConnectTimeout. On the Mac the
 * sanctioned aliases `ca-engine` / `ca-backup` in ~/.ssh/config carry all of
 * that (plus PreferredAuthentications=publickey, NumberOfPasswordPrompts=0)
 * and the same block also matches the raw addresses.
 *
 * This law reads every repo script, runbook and workflow, finds each
 * ssh/scp/rsync invocation that reaches either host, and fails if one lacks
 * the fail-closed options. CLAUDE.md and AGENTS.md must carry the rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(__dirname, '..');

const SCOPE = [
  'CLAUDE.md',
  'AGENTS.md',
  'docs/runbooks',
  'docs/ENGINE-RELEASE-RUNBOOK.md',
  'scripts',
  'operations',
  'ops',
  '.github/workflows',
  '.github/scripts',
];
const TEXT = /\.(md|sh|bash|ya?ml|mjs|cjs|js|ts|py)$|(^|\/)[A-Z]+$/;
const SKIP = /(^|\/)(fixtures|probes|node_modules)\//;

/** The two production hosts, by address, name, sanctioned alias, or CI variable. */
const HOSTS =
  /5\.161\.252\.33|5\.161\.236\.0|engine\.smarter\.poker|\bca-engine\b|\bca-backup\b|\$\{?(HETZNER_HOST|STANDBY_HOST|ENGINE_HOST|READER_HOST|DR_ENGINE_HOST)\b/;
/** The Mac's sanctioned aliases: their fail-closed settings live in ~/.ssh/config. */
const ALIAS = /(^|[\s"'`@])(ca-engine|ca-backup)([\s"'`:]|$)/;
const SHELL_CALL = /(^|[\s"'`(|;&!=])(ssh|scp|rsync)(?=\s)/g;
const PROGRAM_CALL =
  /(?:spawn(?:Sync)?|execFile(?:Sync)?|subprocess\.\w+)\(\s*\[?\s*['"](ssh|scp|rsync)['"]|\[\s*['"](ssh|scp|rsync)['"]\s*,/g;

export function missingFailClosed(command: string): string[] {
  if (ALIAS.test(command) && !/-o\s*(BatchMode|IdentitiesOnly)\s*=\s*no/i.test(command)) return [];
  const missing: string[] = [];
  if (!/BatchMode\s*[= ]\s*['"]?yes/i.test(command)) missing.push('BatchMode=yes');
  if (!/IdentitiesOnly\s*[= ]\s*['"]?yes/i.test(command)) missing.push('IdentitiesOnly=yes');
  if (!/ConnectTimeout\s*[= ]\s*['"]?(\d+|\{\w+\}|\$\{?\w+)/i.test(command))
    missing.push('ConnectTimeout=<seconds>');
  if (!/(^|[\s'"(,])-i[\s'",]|IdentityFile/.test(command)) missing.push('-i <the one pinned key>');
  return missing;
}

function scopeFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...SCOPE], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter((f) => f && TEXT.test(f) && !SKIP.test(f) && !f.endsWith('.sql'))
    .filter((f) => {
      try {
        return statSync(join(ROOT, f)).size < 2_000_000;
      } catch {
        return false;
      }
    });
}

/** Lines with shell continuations joined, keeping the first line number. */
function logicalLines(text: string): Array<{ line: number; text: string }> {
  const raw = text.split('\n');
  const out: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const start = i;
    let joined = raw[i];
    while (/\\\s*$/.test(raw[i]) && i + 1 < raw.length && i - start < 20) {
      i++;
      joined = joined.replace(/\\\s*$/, ' ') + raw[i];
    }
    out.push({ line: start + 1, text: joined });
  }
  return out;
}

/** "${NAME[@]}" expands to the NAME=( ... ) defined in the same file. */
function expandArrays(command: string, file: string): string {
  return command.replace(/"?\$\{(\w+)\[@\]\}"?/g, (whole, name) => {
    const m = file.match(new RegExp(`\\b${name}=\\(([\\s\\S]*?)\\)`));
    return m ? `${whole} ${m[1]}` : whole;
  });
}

/**
 * The statement a program-level ssh call sits in: back to the blank line that
 * opens its paragraph (where its argument list is built) and forward to the
 * blank line that ends it.
 */
function statementAround(file: string, at: number): string {
  const before = file.lastIndexOf('\n\n', at);
  const after = file.indexOf('\n\n', at);
  return file.substring(before < 0 ? 0 : before, after < 0 ? file.length : after);
}

/** The ~/.ssh/config Host block deploy-monitoring.yml writes for the engine. */
function monitoringHostBlock(): string {
  const wf = readFileSync(join(ROOT, '.github/workflows/deploy-monitoring.yml'), 'utf8');
  const m = wf.match(/echo "Host \$HETZNER_HOST"[\s\S]*?\} > ~\/\.ssh\/config/);
  return m ? m[0] : '';
}

type Finding = { where: string; command: string; missing: string[] };

function scan(): { checked: number; findings: Finding[] } {
  const findings: Finding[] = [];
  let checked = 0;
  for (const rel of scopeFiles()) {
    const file = readFileSync(join(ROOT, rel), 'utf8');
    if (!/\b(ssh|scp|rsync)\b/.test(file)) continue;
    // A workflow that binds HOST to the engine secret reaches the engine via $HOST.
    const hosts = /\bHOST:\s*\$\{\{\s*secrets\.HETZNER_HOST/.test(file)
      ? new RegExp(`${HOSTS.source}|\\$\\{?HOST\\b`)
      : HOSTS;

    for (const { line, text } of logicalLines(file)) {
      for (const m of text.matchAll(SHELL_CALL)) {
        const command = expandArrays(text.slice(m.index! + m[1].length), file);
        // `ssh-keygen`, prose like "an ssh key", and calls to other hosts are not this law.
        const target = command.split(/\s(?:&&|\|\||;)\s/)[0];
        if (!hosts.test(target)) continue;
        checked++;
        const missing = missingFailClosed(target);
        if (missing.length)
          findings.push({ where: `${rel}:${line}`, command: target.split('\n')[0], missing });
      }
    }

    if (/\.(mjs|cjs|js|ts|py)$/.test(rel)) {
      for (const m of file.matchAll(PROGRAM_CALL)) {
        let window = expandArrays(statementAround(file, m.index!), file);
        // `ssh $ENGINE_MONITORING_SSH` takes its key from the Host block deploy-monitoring.yml writes.
        if (/ENGINE_MONITORING_SSH/.test(window)) window += ' ' + monitoringHostBlock();
        checked++;
        const missing = missingFailClosed(window);
        if (missing.length) {
          const line = file.slice(0, m.index!).split('\n').length;
          findings.push({
            where: `${rel}:${line}`,
            command: window.trim().split('\n')[0],
            missing,
          });
        }
      }
    }
  }
  return { checked, findings };
}

describe('an agent cannot lock the Mac out of production', () => {
  it('refuses the shape that got the Mac banned, and accepts the fail-closed shape', () => {
    expect(missingFailClosed(`ssh root@5.161.252.33 'docker ps'`)).toEqual([
      'BatchMode=yes',
      'IdentitiesOnly=yes',
      'ConnectTimeout=<seconds>',
      '-i <the one pinned key>',
    ]);
    expect(
      missingFailClosed(
        `ssh -o BatchMode=yes -o ConnectTimeout=8 -i ~/.ssh/k root@5.161.252.33 true`
      )
    ).toEqual(['IdentitiesOnly=yes']);
    expect(
      missingFailClosed(
        `ssh -i ~/.ssh/k -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 root@5.161.236.0 true`
      )
    ).toEqual([]);
    expect(missingFailClosed(`ssh ca-engine 'docker ps'`)).toEqual([]);
    expect(missingFailClosed(`ssh -o BatchMode=no ca-engine true`)).not.toEqual([]);
  });

  it('every ssh/scp/rsync to the engine or Backup host in scripts, runbooks and workflows fails closed', () => {
    const { checked, findings } = scan();
    // The repo reaches these hosts from dozens of places; a scan that finds none is broken.
    expect(checked).toBeGreaterThan(20);
    expect(
      findings.map((f) => `${f.where} missing ${f.missing.join(', ')}: ${f.command}`),
      'Each connection to the engine (5.161.252.33) or the Backup host (5.161.236.0) must be ' +
        'BatchMode=yes, IdentitiesOnly=yes with one -i key, and a ConnectTimeout - or use the ' +
        "Mac's sanctioned alias `ssh ca-engine` / `ssh ca-backup`. A failed login costs a 24 h fail2ban ban."
    ).toEqual([]);
  });

  it('CLAUDE.md and AGENTS.md tell every agent the one route', () => {
    for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
      const text = readFileSync(join(ROOT, doc), 'utf8');
      expect(text, doc).toContain('ssh ca-engine');
      expect(text, doc).toContain('ssh ca-backup');
      expect(text, doc).toMatch(/fail2ban/);
      expect(text, doc).toMatch(/never retry/i);
    }
  });
});
