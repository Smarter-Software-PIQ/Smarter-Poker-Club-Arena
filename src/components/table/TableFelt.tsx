import type { ReactNode } from 'react';

/** The live board, masthead and overlays share this coordinate system. */
export default function TableFelt({ src, children }: { src?: string; children: ReactNode }) {
  return (
    <div className="table-felt">
      <img className="table-art" src={src} alt="" draggable={false} decoding="sync" />
      <div className="table-rail">
        <div className="table-surface">{children}</div>
      </div>
    </div>
  );
}
