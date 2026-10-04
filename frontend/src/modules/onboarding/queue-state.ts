/**
 * What the work queues (Deals, Companies) share besides the table: which
 * columns this viewer hides, and exporting a filtered list to CSV.
 */

import { useCallback, useState } from 'react';

import { downloadCsv, toCsv } from '@/lib/csv';

import type { QueueColumn } from './components/QueueTable';

/**
 * The columns this viewer has hidden — a per-viewer convenience, so browser
 * storage, guarded: a blocked store just means the defaults every visit.
 */
export function useHiddenColumns<Id extends string>(
  storageKey: string,
  columns: readonly Pick<QueueColumn<unknown, string, Id>, 'id' | 'hiddenByDefault'>[],
): [ReadonlySet<Id>, (id: Id) => void, () => void] {
  const defaults = () => new Set(columns.filter((c) => c.hiddenByDefault).map((c) => c.id));
  const [hidden, setHidden] = useState<Set<Id>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw) as Id[]) : defaults();
    } catch {
      return defaults();
    }
  });

  const store = useCallback(
    (next: Set<Id>) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // The choice just won't outlive this page view.
      }
      setHidden(next);
    },
    [storageKey],
  );

  const toggle = (id: Id) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    store(next);
  };
  const reset = () => store(defaults());

  return [hidden, toggle, reset];
}

/** The server's largest page — an export walks the list in these. */
const EXPORT_PAGE_SIZE = 200;
/** Where an export stops; past this a narrower filter is the better tool. */
export const EXPORT_MAX_ROWS = 5000;

/**
 * Every row a filter matches, page by page, up to `EXPORT_MAX_ROWS` — then one
 * CSV with the given columns. Returns how many rows went in.
 */
export async function exportQueueCsv<Row>(
  filename: string,
  columns: readonly QueueColumn<Row, string>[],
  fetchPage: (limit: number, offset: number) => Promise<{ rows: Row[]; total: number }>,
): Promise<number> {
  const rows: Row[] = [];
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const page = await fetchPage(EXPORT_PAGE_SIZE, offset);
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length < EXPORT_PAGE_SIZE) break;
  }
  const all = rows.slice(0, EXPORT_MAX_ROWS);
  downloadCsv(
    filename,
    toCsv([columns.map((c) => c.label), ...all.map((row) => columns.map((c) => c.text(row)))]),
  );
  return all.length;
}
