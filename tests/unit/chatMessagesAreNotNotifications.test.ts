import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHAT_NOTIFICATION_TYPE_FILTER,
  isChatNotificationType,
  withoutChatNotifications,
} from '../../src/lib/chatNotificationTypes';

// Dan 2026-11-18: chat messages appear in the Messenger pop-up, never the
// Notifications tab or the bell count.
describe('chat messages are not notifications', () => {
  it('drops every chat row type and keeps everything else', () => {
    const rows = [
      { id: '1', type: 'new_message', title: 'Butter', message: 'Send 200' },
      { id: '2', type: 'message' },
      { id: '3', type: 'messenger_message' },
      { id: '4', type: 'chip_request', title: 'Chip Request' },
      { id: '5', type: 'waitlist_seat_open' },
      { id: '6', type: null },
    ];
    expect(withoutChatNotifications(rows).map((r) => r.id)).toEqual(['4', '5', '6']);
    expect(isChatNotificationType(' New_Message ')).toBe(true);
    expect(isChatNotificationType('accounting_invoice')).toBe(false);
    expect(CHAT_NOTIFICATION_TYPE_FILTER).toBe('(new_message,message,messenger_message)');
  });

  it('the page list and every bell count exclude chat rows at the source', () => {
    const page = readFileSync('src/pages/NotificationsPage.tsx', 'utf8');
    expect(page).toMatch(/const shown = withoutChatNotifications\(rows\)/);
    expect(page).toMatch(/withoutChatNotifications\(readCache\(userId\)\)/);
    const store = readFileSync('src/stores/useHeaderDataStore.ts', 'utf8');
    const counts = store.match(/\.select\('\*', \{ count: 'exact', head: true \}\)[\s\S]{0,200}?\.eq\('read', false\)[^\n]*\n[^\n]*/g) ?? [];
    expect(counts.length).toBeGreaterThan(0);
    for (const q of counts) expect(q).toContain(".not('type', 'in', CHAT_NOTIFICATION_TYPE_FILTER)");
  });
});
