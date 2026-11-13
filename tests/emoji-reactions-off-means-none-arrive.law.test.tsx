/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  THE EMOJI REACTIONS SWITCH IS A RECEIVE GATE (Dan 2026-11-12, binding)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Verbatim: "TURNING EMOJI OR THROWABLE REACTIONS ON AND OFF MUST BE TURNED ON
 * AND WORKING. IF A USER WANTS TO TURN THEM OFF AND NOT SEE IT, THEY SHOULD
 * JUST TURN OFF, BUT THE BUTTON DOESN'T SEEM TO WORK, IT'S SILENTLY FAILING."
 *
 * It was not failing to save, which is why it was so hard to see. The column
 * wrote, the switch stayed where it was put, and it changed only the OUTBOUND
 * half of the feature: the throwable selector, the Hero Hub throwables tab and
 * the TableReactions overlay. The inbound door — `parseIncomingMessage` in
 * useTableChat, the one place both `[REACTION:...]` and `[THROW:...]` enter
 * this client — read nothing at all. A player who switched Emoji Reactions off
 * lost the ability to send one and kept watching every tomato in the room land
 * on their felt.
 *
 * The pins below are the whole contract, and they are deliberately split
 * between behaviour and shape:
 *
 *   BEHAVIOUR — the gate is read at DELIVERY time, not at subscribe time.
 *   A captured boolean would freeze at whatever the setting was when the table
 *   was joined, which is the same bug one layer down, and no source pin can
 *   tell the two apart. These run the hook.
 *
 *   SHAPE — TablePage must keep wiring the live setting into that gate and must
 *   keep the render-side fail-safe. A perfect hook that nobody passes the
 *   setting to is exactly the state this fixed.
 *
 * If a change turns one of these red it is re-shipping a switch that moves and
 * does nothing. Fix the change; do not weaken the pin.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

afterEach(cleanup);

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue('subscribed'),
      unsubscribe: vi.fn(),
    }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
  },
}));

import { useTableChat } from '../src/hooks/useTableChat';

const read = (p: string) => readFileSync(resolve(__dirname, '../', p), 'utf8');

describe('Emoji Reactions OFF means none arrive', () => {
  it('drops an incoming reaction instead of painting it', () => {
    const { result } = renderHook(() =>
      useTableChat(undefined, 'receiver', [{ id: 'sender' }], undefined, () => false)
    );
    let consumed = false;
    act(() => {
      consumed = result.current.parseIncomingMessage('[REACTION:smile:1]', 'sender');
    });
    expect(result.current.activeReactions).toHaveLength(0);
    /* Consumed, not passed through. Returning false would push the raw
       `[REACTION:smile:1]` wire text into the chat feed as an ordinary
       message — a louder version of the thing the player switched off. */
    expect(consumed).toBe(true);
    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('drops an incoming throwable instead of flying it across the felt', () => {
    const received = vi.fn();
    const { result } = renderHook(() =>
      useTableChat(undefined, 'receiver', [{ id: 'sender' }], received, () => false)
    );
    let consumed = false;
    act(() => {
      consumed = result.current.parseIncomingMessage('[THROW:tomato:2]', 'sender');
    });
    expect(received).not.toHaveBeenCalled();
    expect(consumed).toBe(true);
    expect(result.current.chatMessages).toHaveLength(0);
  });

  it('still delivers both while the setting is ON', () => {
    const received = vi.fn();
    const { result } = renderHook(() =>
      useTableChat(undefined, 'receiver', [{ id: 'sender' }], received, () => true)
    );
    act(() => {
      result.current.parseIncomingMessage('[REACTION:smile:1]', 'sender');
      result.current.parseIncomingMessage('[THROW:tomato:2]', 'sender');
    });
    expect(result.current.activeReactions).toHaveLength(1);
    expect(received).toHaveBeenCalledWith(1, 2, 'tomato', undefined);
  });

  it('a caller that passes no gate is not silently muted', () => {
    const received = vi.fn();
    const { result } = renderHook(() =>
      useTableChat(undefined, 'receiver', [{ id: 'sender' }], received)
    );
    act(() => {
      result.current.parseIncomingMessage('[REACTION:smile:1]', 'sender');
      result.current.parseIncomingMessage('[THROW:tomato:2]', 'sender');
    });
    expect(result.current.activeReactions).toHaveLength(1);
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('reads the setting at delivery time, so a mid-session flip is live', () => {
    /* The reason the gate is a getter. A boolean captured when the table was
       joined would keep the player's old answer for the whole session: they
       would flip the switch, see no change, and report the same silent
       failure one layer deeper. */
    let enabled = true;
    const received = vi.fn();
    const { result } = renderHook(() =>
      useTableChat(undefined, 'receiver', [{ id: 'sender' }], received, () => enabled)
    );
    act(() => {
      result.current.parseIncomingMessage('[THROW:tomato:2]', 'sender');
    });
    expect(received).toHaveBeenCalledTimes(1);

    enabled = false;
    act(() => {
      result.current.parseIncomingMessage('[REACTION:smile:1]', 'sender');
      result.current.parseIncomingMessage('[THROW:tomato:2]', 'sender');
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(result.current.activeReactions).toHaveLength(0);

    enabled = true;
    act(() => {
      result.current.parseIncomingMessage('[THROW:tomato:2]', 'sender');
    });
    expect(received).toHaveBeenCalledTimes(2);
  });
});

describe('TablePage keeps the gate wired and the felt fail-safe', () => {
  const TABLE_PAGE = read('src/pages/TablePage.tsx');

  it('hands useTableChat the live setting, not a snapshot', () => {
    expect(TABLE_PAGE).toContain('() => emojiEnabledRef.current');
    expect(TABLE_PAGE).toContain('emojiEnabledRef.current = !!v8Settings.emoji_enabled;');
  });

  it('will not paint a throw that was already in flight when the switch went off', () => {
    expect(TABLE_PAGE).toContain(
      'events={v8Settings.emoji_enabled ? activeThrows : EMPTY_THROW_EVENTS}'
    );
  });

  it('drains the playback queue while the setting is off', () => {
    /* The container is fed an empty list rather than unmounted, because
       unmounting kills the onEventComplete callback that is the queue's only
       exit — every throw would replay the moment reactions came back on, and
       at MAX_ACTIVE_THROWS the backlog would stop accepting new ones. */
    expect(TABLE_PAGE).toContain(
      'for (const event of activeThrows) handleThrowComplete(event.id);'
    );
  });

  it('keeps the send-side gates it already had', () => {
    expect(TABLE_PAGE).toContain('{v8Settings.emoji_enabled && (');
    expect(TABLE_PAGE).toContain('emojiEnabled={!!v8Settings.emoji_enabled}');
  });
});
