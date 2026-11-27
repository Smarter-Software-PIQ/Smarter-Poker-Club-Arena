/**
 * Dan, 2026-11-27: "THE COLORS ON THE LEFT SIDE SHOULD BE REPRESENTIVE OF WHAT
 * THERE LEVEL IN THE CLUB IS ... OWNER, CO OWNER AND ADMINS ARE GREEN. SUPER
 * AGENTS, AGENTS AND SUB AGENTS TEAL, AND PLAYERS BLUE."
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clubLevel } from '../../src/types/clubRoles';

const root = resolve(__dirname, '../..');
const PAGE = readFileSync(resolve(root, 'src/pages/ClubMembersPage.tsx'), 'utf8');
const CSS = readFileSync(resolve(root, 'src/components/lobby/ArenaWorkspace.css'), 'utf8');

describe('a player card shows its club level on its left edge', () => {
  it('puts every role in its level', () => {
    for (const role of ['owner', 'co_owner', 'admin']) expect(clubLevel(role)).toBe('staff');
    for (const role of ['super_agent', 'agent', 'sub_agent']) expect(clubLevel(role)).toBe('agent');
    for (const role of ['player', 'member', null, undefined, ''])
      expect(clubLevel(role)).toBe('player');
  });

  it('marks each card with its level', () => {
    expect(PAGE).toMatch(/data-club-level=\{clubLevel\(member\.role\)\}/);
  });

  it('paints staff green, agents teal and players blue', () => {
    const edge = (level: string) =>
      new RegExp(
        `\\.member-row\\[data-club-level='${level}'\\]::before \\{\\s*background: (#[0-9a-f]{6});`
      ).exec(CSS)?.[1];
    expect(edge('staff')).toBe('#35d95a');
    expect(edge('agent')).toBe('#2dd4bf');
    expect(edge('player')).toBe('#45adff');
  });
});
