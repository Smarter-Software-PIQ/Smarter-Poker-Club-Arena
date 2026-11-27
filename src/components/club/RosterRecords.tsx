/**
 * THE BOTTOM OF PLAYER MANAGEMENT, IN #SMARTERDESIGN (Dan 2026-11-27).
 *
 * Dan, with a screenshot of the roster footer: "ALL OF THIS ON THE BOTTOM OF
 * THE PLAYER MANAGEMENT PAGE NEEDS TO BE UPGRADED WITH THE #SMARTERDESIGN".
 * Then, shown it rebuilt on the painted spade console: "NO DO NOT USE THOSE
 * BULKY FRAMES, THATS THE OLD STYLE... USE THE #SMARTERDESIGN STYLE".
 *
 * #SmarterDesign on a routed page is the arena workspace the rest of this page
 * and the Cashier already wear (src/components/lobby/ArenaWorkspace.css): the
 * thin chrome case (`arena-case`), a section title over a hairline
 * (`arena-section-title`), chrome readout tiles (`arena-meter`), chrome-stat
 * buttons (`arena-switch`) with the lit blue chrome for the primary one, dark
 * search-style fields and chrome ledger rows. No painted console.
 *
 * Two cases:
 *
 *   Roster Export   loaded / matching / selected readouts, Select Loaded and
 *                   Export CSV, the export scope and receipt, and Metric
 *                   Definitions.
 *   Change History  the audit trail disclosure, its filters and records.
 *
 * Nothing here owns state. The page keeps every guard, ref and handler; this
 * only lays its strings and controls out, so every literal the roster tests
 * pin (Select Loaded, Export CSV, Export Selected (n), the Roster Export
 * group, the Export Scope note, Metric Definitions, the Export Operation
 * status) is the same text on the same role.
 */
import type { ReactNode } from 'react';
import './RosterRecords.css';

export function RosterExportCase({
  loadedCount,
  matchingTotal,
  isLoadingMore,
  canExport,
  selectedCount,
  loadedSelected,
  onToggleLoaded,
  onExport,
  exportDisabled,
  isExporting,
  definitions,
  receipt,
}: {
  loadedCount: number;
  matchingTotal: number;
  isLoadingMore: boolean;
  canExport: boolean;
  selectedCount: number;
  loadedSelected: boolean;
  onToggleLoaded: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  isExporting: boolean;
  /** The Metric Definitions paragraphs. */
  definitions: ReactNode;
  /** The Export Operation status, already worded by the page. */
  receipt?: ReactNode;
}) {
  return (
    <section className="arena-case roster-records" aria-label="Roster Export Tools">
      <h2 className="arena-section-title">
        Roster Export
        {/* The readouts below show the counts; this line keeps the page's
            live status for a screen reader and says when more are loading. */}
        {loadedCount > 0 && (
          <small role="status" aria-live="polite">
            {isLoadingMore ? (
              'Loading More Players...'
            ) : (
              <span className="roster-records__sr">
                {`Loaded ${loadedCount.toLocaleString()} Of ${matchingTotal.toLocaleString()}`}
              </span>
            )}
          </small>
        )}
      </h2>

      <dl className="roster-records__meters">
        <div className="arena-meter">
          <dt>Loaded</dt>
          <dd>{loadedCount.toLocaleString()}</dd>
        </div>
        <div className="arena-meter">
          <dt>Matching</dt>
          <dd>{matchingTotal.toLocaleString()}</dd>
        </div>
        <div className="arena-meter" data-tone={selectedCount ? 'live' : undefined}>
          <dt>Selected</dt>
          <dd>{selectedCount.toLocaleString()}</dd>
        </div>
      </dl>

      {canExport && (
        <>
          <div
            className="arena-switch roster-records__actions"
            role="group"
            aria-label="Roster Export"
          >
            {loadedCount > 0 && (
              <button type="button" aria-pressed={loadedSelected} onClick={onToggleLoaded}>
                {loadedSelected ? 'Clear Selection' : 'Select Loaded'}
              </button>
            )}
            <button
              type="button"
              className="roster-records__primary"
              onClick={onExport}
              disabled={exportDisabled}
            >
              {isExporting
                ? 'Preparing...'
                : selectedCount
                  ? `Export Selected (${selectedCount})`
                  : 'Export CSV'}
            </button>
          </div>
          <p className="roster-records__note" role="note" aria-label="Export Scope">
            <strong>Export Scope: </strong>
            <span>
              {selectedCount
                ? 'Selected Players Matching The Current Filter And Search'
                : 'All Matching Players Across Every Page'}
            </span>{' '}
            Includes Authorized Fields Regardless Of Visible Columns.
          </p>
        </>
      )}

      {receipt}

      <details className="roster-records__disclosure">
        <summary>Metric Definitions</summary>
        <div className="roster-records__definitions">{definitions}</div>
      </details>
    </section>
  );
}

export function ChangeHistoryCase({ children }: { children: ReactNode }) {
  return (
    <section
      className="arena-case roster-records roster-records--history"
      aria-label="Change History"
    >
      <h2 className="arena-section-title">
        Change History
        <small>Staff Only</small>
      </h2>
      {children}
    </section>
  );
}
