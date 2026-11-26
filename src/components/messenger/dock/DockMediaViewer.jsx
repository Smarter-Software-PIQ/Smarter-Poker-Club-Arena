import { useEffect, useRef, useState } from 'react';

/**
 * In-app photo lightbox for the Club Arena Messenger dock.
 * Uses a native top-layer <dialog closedby="any"> opened with showModal() plus
 * the Safari bounding-box click fallback so players inspect photos without
 * leaving the poker table or losing their scroll position and draft.
 */
export default function DockMediaViewer({ url, label = 'Photo Attachment', onClose }) {
  const dialogRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open && typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        /* fallback if already open */
      }
    }
    const handleClose = () => onClose?.();
    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss for browsers without native <dialog closedby="any"> (Safari).
    const supportsClosedBy =
      typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
    const handleBackdropClick = (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    };
    if (!supportsClosedBy) {
      dialog.addEventListener('click', handleBackdropClick);
    }
    return () => {
      dialog.removeEventListener('close', handleClose);
      if (!supportsClosedBy) dialog.removeEventListener('click', handleBackdropClick);
      if (dialog.open) {
        try {
          dialog.close();
        } catch {
          /* unmounting */
        }
      }
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="dock-media-viewer"
      aria-label={label}
      {...{ closedby: 'any' }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          event.stopPropagation();
          onClose?.();
        }
      }}
    >
      <div className="dock-media-viewer-inner" onClick={(event) => event.stopPropagation()}>
        {failed ? (
          <a
            className="dock-media-viewer-fallback"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Unable To Load Photo · Tap To Open Original
          </a>
        ) : (
          <img
            src={url}
            alt={label}
            onError={() => setFailed(true)}
            className="dock-media-viewer-img"
          />
        )}
        <button
          type="button"
          className="dock-media-viewer-close"
          aria-label="Close Photo"
          onClick={(event) => {
            event.stopPropagation();
            onClose?.();
          }}
        >
          ×
        </button>
      </div>
    </dialog>
  );
}
