/**
 * A TABLE MENU PRESS IS A TAP (Dan, 2026-11-14).
 *
 * The bus drops an event whose payload repeats inside 500ms. Every press of one
 * menu row at one table carries the same payload, and the menu's switches stay
 * open now, so ON then OFF inside half a second is ordinary use. On the real
 * bus: both presses arrive.
 */
import { describe, expect, it, vi } from 'vitest';

/* tests/setup.ts replaces the bus for every file; this one is about the bus. */
const { masterBus } = await vi.importActual<typeof import('../../src/core/MasterBus')>(
  '../../src/core/MasterBus'
);

describe('TABLE_MENU_ACTION on the real bus', () => {
  it('delivers the same press twice in a row', () => {
    const seen: string[] = [];
    const off = masterBus.subscribe('TABLE_MENU_ACTION', ({ payload }) => {
      seen.push(payload.action);
    });
    masterBus.emit('TABLE_MENU_ACTION', { tableId: 't-1', action: 'TOGGLE_SOUNDS' });
    masterBus.emit('TABLE_MENU_ACTION', { tableId: 't-1', action: 'TOGGLE_SOUNDS' });
    off();
    expect(seen).toEqual(['TOGGLE_SOUNDS', 'TOGGLE_SOUNDS']);
  });
});
