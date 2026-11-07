export const SOURCE: string;
export const TARGET: string;
export const SHIP_FROM: string;
export interface OwnerMaintenanceNoticeRow {
  id: string;
  kind: 'engine' | 'database';
  noticeAt: string | null;
  notBefore: string;
  notAfter: string;
}
export function projectOwnerMaintenanceNotices(doc: {
  windows?: Record<string, unknown>[];
  databaseWindows?: Record<string, unknown>[];
}): { source: string; shipFrom: string; notices: OwnerMaintenanceNoticeRow[] };
export function renderOwnerMaintenanceNotices(root?: string): string;
