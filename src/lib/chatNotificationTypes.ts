/**
 * CHAT MESSAGES ARE NOT NOTIFICATIONS (Dan 2026-11-18).
 *
 * "You should not receive notifications for chat messages, those should
 * appear in the chat messenger pop up, not in the notifications tab."
 *
 * A direct message still writes a `new_message` row: it drives web push, the
 * Messages badge and the live hand-off to the Messenger dock
 * (useHeaderDataStore -> NEW_MESSAGE_EVENT). It must never be listed in the
 * Notifications page or counted on the bell. These are the chat row types.
 */
export const CHAT_NOTIFICATION_TYPES = [
  'new_message',
  'message',
  'messenger_message',
] as const;

/** PostgREST `in` list for `.not('type', 'in', CHAT_NOTIFICATION_TYPE_FILTER)`. */
export const CHAT_NOTIFICATION_TYPE_FILTER = `(${CHAT_NOTIFICATION_TYPES.join(',')})`;

export function isChatNotificationType(type: unknown): boolean {
  return (
    typeof type === 'string' &&
    (CHAT_NOTIFICATION_TYPES as readonly string[]).includes(type.trim().toLowerCase())
  );
}

/** The rows a notification list may show: everything except chat messages. */
export function withoutChatNotifications<T extends { type?: unknown }>(rows: T[]): T[] {
  return rows.filter((row) => !isChatNotificationType(row?.type));
}
