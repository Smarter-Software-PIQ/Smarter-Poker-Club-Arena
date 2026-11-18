/**
 * THE LINK ITSELF, WHEN NOTHING COULD COPY IT (2026-11-15).
 *
 * src/lib/share.ts ends its ladder with "failed" only when the share sheet,
 * the Clipboard API and the selection copy all refused. The caller then owes
 * the player the link so it can be copied by hand. Two surfaces put it in an
 * error toast ("Could Not Share. Copy This Link: <url>"), and the Toast layer
 * sanitises error text (utils/safeErrorMessage.ts) - a URL reads as a machine
 * fingerprint - so on production the player read "Could Not Share. Copy This
 * Link. Please Try Again." with no link anywhere. Found during the signed-in
 * check on 2026-11-15.
 *
 * The link is printed here instead, in a read-only field that is selected the
 * moment it appears, so Cmd+C / long-press copies it.
 */
import { useEffect, useRef } from 'react';
import './ShareLinkFallback.css';

export function ShareLinkFallback({ url, label = 'Link' }: { url: string; label?: string }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    try {
      ref.current?.focus();
      ref.current?.select();
    } catch {
      /* the link is still on screen */
    }
  }, [url]);
  return (
    <div className="share-link-fallback" role="alert">
      <p className="share-link-fallback__note">
        Copy Is Blocked Here. The {label} Is Selected, Copy It By Hand.
      </p>
      <input
        ref={ref}
        className="share-link-fallback__url"
        type="text"
        readOnly
        value={url}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
