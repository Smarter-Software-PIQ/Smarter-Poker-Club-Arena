/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TABLE HUD — 4-Corner Overlay Layout
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Clean table HUD with fixed-position corner elements:
 *   - Upper-left:  Hamburger menu (internal to table)
 *   - Left dock:   Stand Up & Leave, in line with the chat icon opposite
 *   - Upper-right: Mini stats card (VPIP, buy-in, winnings)
 *   - Bottom-left: Previous hand card (quick-access hand history)
 *   - Bottom-right: Messages icon (table chat, transparent)
 *
 * Replaces the old header bar with a cleaner overlay approach that
 * keeps the table felt visible and uncluttered.
 */

import React from 'react';
import './TableHUD.css';
import './TableToolIconSizing.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface TableHUDProps {
  /** Upper-left corner: hamburger menu trigger + dropdown */
  upperLeft?: React.ReactNode;
  /** Upper-right corner: mini stats card */
  upperRight?: React.ReactNode;
  /** Bottom-left corner: previous hand card */
  bottomLeft?: React.ReactNode;
  /** Bottom-right corner: messages icon */
  bottomRight?: React.ReactNode;
  /** Center-top: optional game info bar (table name, blinds) */
  centerTop?: React.ReactNode;
  /**
   * Upper-left dock, under the top chrome: the mirror of the chat icon on the
   * opposite edge. Dan 2026-11-08, about Stand Up & Leave: "IT SHOULD BE IN
   * THE UPPER LEFT HAND CORNER BELOW THE HAMBURGER MENU. NOT OVERLAPPING
   * ANYTHING ... IT SHOULD BE LINED UP HOW THE CHAT MESSAGE ICON IS."
   *
   * It is a dock of its own rather than another child of the upper-left
   * CORNER, because that corner is in the flex row at the top of the HUD and
   * a widget placed in it rides whatever the hamburger does. This one is
   * pinned, like .hud-seat-change-dock and .chat-collapsed, so it lands on the
   * same line as chat whatever else is mounted.
   */
  leftDock?: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function TableHUD({
  upperLeft,
  upperRight,
  bottomLeft,
  bottomRight,
  centerTop,
  leftDock,
}: TableHUDProps) {
  return (
    <div className="table-hud" aria-label="Table HUD Overlay">
      {/* Upper row */}
      <div className="table-hud__upper">
        <div className="table-hud__corner table-hud__corner--ul">{upperLeft}</div>
        {centerTop && <div className="table-hud__center-top">{centerTop}</div>}
        <div className="table-hud__corner table-hud__corner--ur">{upperRight}</div>
      </div>

      {/* Pinned left dock — outside both rows on purpose; see leftDock above. */}
      {leftDock && <div className="hud-leave-dock">{leftDock}</div>}

      {/* Lower row */}
      <div className="table-hud__lower">
        <div className="table-hud__corner table-hud__corner--bl">{bottomLeft}</div>
        <div className="table-hud__corner table-hud__corner--br">{bottomRight}</div>
      </div>
    </div>
  );
}

export default TableHUD;
