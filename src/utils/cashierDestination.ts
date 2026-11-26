/**
 * Which cashier surface a club switch keeps the viewer on.
 *
 * Lived in src/components/club/CashierClubSwitcher.tsx until the regression
 * review of 2026-10-10 (G-06): a component module that exports a plain
 * function loses React Fast Refresh.
 */

/** Keep the selected tool when switching clubs; a table context belongs to its original club. */
export function cashierDestination(pathname: string): string {
  return /\/cashier\/statements\/?$/.test(pathname) ? 'cashier/statements' : 'cashier';
}
