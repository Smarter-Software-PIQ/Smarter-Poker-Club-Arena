/*
 * COPY THAT WORKS WHERE THE CLIPBOARD API IS REFUSED (2026-11-06).
 *
 * navigator.clipboard.writeText exists in every modern browser, but it is not
 * always allowed: an in-app webview, an embedded browser pane or a page
 * without focus answers NotAllowedError ("Write permission denied"). The two
 * Copy Link buttons only fell back to the selection copy when the API was
 * MISSING, so in those places the tap did nothing at all - and a link that was
 * never copied was still counted as sent. Measured on the live Share Hand
 * popup in the desktop app's built-in browser.
 *
 * The answer is a boolean so a caller can tell a copy that happened from one
 * that did not, and record "sent" only for the first.
 */
/**
 * Mount the temporary selection textarea inside the topmost open modal
 * `<dialog>` when one exists: per the HTML spec, `showModal()` marks
 * `document.body` (and everything outside the modal dialog) `inert`, which
 * silently prevents `select()` / `execCommand('copy')` from working if the
 * textarea is appended to `document.body` while a modal `<dialog>` (such as
 * `HeadsUpWaitingModal`) is open.
 */
function findCopyHost(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (typeof document.querySelectorAll === 'function') {
    const dialogs = Array.from(document.querySelectorAll('dialog'));
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const dialog = dialogs[i];
      if (!dialog.open) continue;
      try {
        if (dialog.matches(':modal')) return dialog;
      } catch {
        // Older browsers without `:modal` support: fall back to the topmost open dialog.
        return dialog;
      }
    }
  }
  return document.body;
}

function copyBySelection(text: string): boolean {
  const host = findCopyHost();
  if (!host) return false;
  const previousActive =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  host.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    ta.remove();
    try {
      if (previousActive && previousActive.isConnected) {
        previousActive.focus({ preventScroll: true });
      }
    } catch {
      /* ignore focus restore failure */
    }
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (permission, focus, webview policy): try the selection copy.
    }
  }
  return copyBySelection(text);
}
