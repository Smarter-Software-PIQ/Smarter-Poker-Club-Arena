import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../utils/errorReporter';

/** A progress snapshot belongs to the account and the explicit request that produced it. */
export function useRequestedPromoRead<T, Input>(
  scope: string,
  read: (input: Input, signal: AbortSignal) => Promise<T>,
  errorSource: string
) {
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const pending = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{
    scope: string;
    input: Input;
    value: T | null;
    loading: boolean;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    setResult(null);
    return () => pending.current?.abort();
  }, [scope]);

  const request = useCallback(
    async (input: Input) => {
      if (liveScope.current !== scope) return;
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setResult({ scope, input, value: null, loading: true, error: false });
      try {
        const value = await read(input, controller.signal);
        if (!controller.signal.aborted && liveScope.current === scope)
          setResult({ scope, input, value, loading: false, error: false });
      } catch (error) {
        if (!controller.signal.aborted && liveScope.current === scope) {
          reportError(error, errorSource);
          setResult({ scope, input, value: null, loading: false, error: true });
        }
      }
    },
    [scope, read, errorSource]
  );

  return { result: result?.scope === scope ? result : null, request };
}
