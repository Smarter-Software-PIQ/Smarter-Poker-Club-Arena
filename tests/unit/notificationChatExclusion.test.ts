import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHAT_MESSAGE_NOTIFICATION_TYPES,
  CHAT_MESSAGE_TYPE_EXCLUSION_OR,
  isChatMessageNotificationType,
} from '../../src/lib/notificationFilters';

const ROOT = resolve(__dirname, '../..');

describe('chat notifications stay out of Club Arena notifications surfaces', () => {
  it('recognizes all chat/conversation notification types and keeps non-chat notifications visible', () => {
    for (const type of CHAT_MESSAGE_NOTIFICATION_TYPES) {
      expect(isChatMessageNotificationType(type)).toBe(true);
      expect(isChatMessageNotificationType(type.toUpperCase())).toBe(true);
    }
    for (const visible of [
      'club_invite_joined',
      'club_announcement',
      'tournament_start',
      'accounting_invoice',
      'waitlist_seat_open',
      'friend_accept',
      null,
      undefined,
      '',
    ]) {
      expect(isChatMessageNotificationType(visible)).toBe(false);
    }
    expect(CHAT_MESSAGE_TYPE_EXCLUSION_OR).toBe(
      'type.is.null,type.not.in.(new_message,message,messenger_message,direct_message)'
    );
  });

  it('wires the chat exclusion filter into NotificationsPage, NotificationDropdown, useHeaderDataStore, and NotificationService', () => {
    const page = readFileSync(resolve(ROOT, 'src/pages/NotificationsPage.tsx'), 'utf8');
    const dropdown = readFileSync(
      resolve(ROOT, 'src/components/navigation/NotificationDropdown.tsx'),
      'utf8'
    );
    const headerStore = readFileSync(resolve(ROOT, 'src/stores/useHeaderDataStore.ts'), 'utf8');
    const service = readFileSync(resolve(ROOT, 'src/services/NotificationService.ts'), 'utf8');

    expect(page).toContain('isChatMessageNotificationType');
    expect(dropdown).toContain('isChatMessageNotificationType');
    expect(dropdown).toContain('CHAT_MESSAGE_TYPE_EXCLUSION_OR');
    expect(headerStore).toContain('CHAT_MESSAGE_TYPE_EXCLUSION_OR');
    expect(service).toContain('CHAT_MESSAGE_TYPE_EXCLUSION_OR');
    // Live message popups still receive NEW_MESSAGE_EVENT from Realtime.
    expect(headerStore).toContain("row?.type === 'new_message'");
  });
});
