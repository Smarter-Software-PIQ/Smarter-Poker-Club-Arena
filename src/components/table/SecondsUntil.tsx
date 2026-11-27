import type { ReactNode } from 'react';
import { useSecondsUntil } from '../../hooks/useSecondsUntil';

/**
 * THE CLOCK LIVES WHERE IT IS READ (2026-11-27). The bust rebuy countdown used
 * to tick in LiveTablePage itself, so every second of a rebuy window
 * re-rendered the whole table (one LiveTablePage per open table when
 * multi-tabling) to change one number on one sheet. The deadline is handed
 * down instead, and only this wrapper and what it renders re-render as the
 * seconds turn. The value it passes is computed exactly as before.
 */
export function SecondsUntil({
  localDeadlineMs,
  children,
}: {
  localDeadlineMs: number | null;
  children: (secondsLeft: number | null) => ReactNode;
}) {
  const secondsLeft = useSecondsUntil(localDeadlineMs);
  return <>{children(secondsLeft)}</>;
}
