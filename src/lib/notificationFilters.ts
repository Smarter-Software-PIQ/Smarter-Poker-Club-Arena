/**
 * Chat/conversation notifications belong in Messenger, never in the
 * Notifications inbox, dropdown, or bell unread count.
 *
 * `new_message` rows remain in `public.notifications` so Realtime live-message
 * alerts (`MessageAlertsHost`) and Web Push keep working, while every
 * Notifications list/badge surface excludes them.
 */
export const CHAT_MESSAGE_NOTIFICATION_TYPES = [
  'new_message',
  'message',
  'messenger_message',
  'direct_message',
] as const;

const CHAT_MESSAGE_NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(
  CHAT_MESSAGE_NOTIFICATION_TYPES
);

export const CHAT_MESSAGE_TYPE_EXCLUSION_OR = `type.is.null,type.not.in.(${CHAT_MESSAGE_NOTIFICATION_TYPES.join(',')})`;

export function isChatMessageNotificationType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  return CHAT_MESSAGE_NOTIFICATION_TYPE_SET.has(type.trim().toLowerCase());
}
