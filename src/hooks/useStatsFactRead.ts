import { createContext, useContext, useEffect, useState } from 'react';

/** Advances when this player's recorded activity changes. Wallet-only events have a separate signal. */
export const StatsPersonalRevision = createContext(0);

/** Changing the query hides its old scope immediately. A new revision refreshes the same query in place. */
export function useStatsFactRead<T extends { error?: string }>(read: () => Promise<T> | null) {
  const revision = useContext(StatsPersonalRevision);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ read: typeof read; data: T | null; error?: string }>();
  useEffect(() => {
    let active = true;
    const pending = read();
    if (!pending) {
      setResult({ read, data: null });
      return;
    }
    void pending.then(
      (data) => {
        if (active) setResult({ read, data, error: data.error });
      },
      () => {
        if (active) setResult({ read, data: null, error: 'Read failed' });
      }
    );
    return () => {
      active = false;
    };
  }, [read, revision, attempt]);
  const current = result?.read === read ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    retry: () => setAttempt((n) => n + 1),
  };
}
