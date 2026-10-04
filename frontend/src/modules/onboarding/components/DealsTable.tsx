/**
 * The Deals table — build prompt chunk 1; Centrex §5 ("Contact List /
 * Operational Workbench").
 *
 * The shared `QueueTable` with the deal's columns (`deal-columns.tsx`), its
 * first column pinned, and an open arrow at the end. The company page's scoped
 * list (chunk 1.5) and saved lists (chunk 3) render through this component, so it
 * takes its rows, visible columns and sort from the caller and fetches nothing.
 * "Deal" is the word on screen; in code a deal stays a `Deal`.
 *
 * Nothing here masks: the rows carry no identifiers, and the one field DEVELOPER
 * may not see (the company's background check, decision D8) arrives from the
 * server as `null` — the column is also left out of DEVELOPER's choices.
 */

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { paths } from '../paths';
import type { DealQueueItem, DealQueueSort } from '../types';

import type { DealColumn } from './deal-columns';
import { QueueTable, type QueueSort } from './QueueTable';

export type DealsSort = QueueSort<DealQueueSort>;

export function DealsTable({
  rows,
  columns,
  sort,
  onSortChange,
  isLoading = false,
  empty,
}: {
  rows: readonly DealQueueItem[];
  columns: readonly DealColumn[];
  sort?: DealsSort;
  onSortChange?: (next: DealsSort) => void;
  isLoading?: boolean;
  empty: ReactNode;
}) {
  return (
    <QueueTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      rowHref={(row) => paths.deal(row.id)}
      endLabel={{ text: 'Open', visible: false }}
      endCell={(row) => (
        <Link
          to={paths.deal(row.id)}
          aria-label={`Open ${row.reference}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint opacity-60 transition hover:bg-surface-sunken hover:text-ink group-hover:opacity-100"
        >
          <ChevronRight size={16} />
        </Link>
      )}
      pinFirst
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      empty={empty}
      rowTestId="deal-row"
    />
  );
}
