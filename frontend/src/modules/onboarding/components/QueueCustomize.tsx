/**
 * Customize — show or hide a work queue's columns (Centrex's "Customize").
 * Shared by the Deals and Companies lists; the choice itself is kept per
 * viewer by `useHiddenColumns`.
 */

import { Columns3 } from 'lucide-react';

import type { QueueColumn } from './QueueTable';

export function QueueCustomize<Id extends string>({
  columns,
  hidden,
  onToggle,
  onReset,
}: {
  columns: readonly Pick<QueueColumn<unknown, string, Id>, 'id' | 'label' | 'fixed'>[];
  hidden: ReadonlySet<Id>;
  onToggle: (id: Id) => void;
  onReset: () => void;
}) {
  return (
    <details className="relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink [&::-webkit-details-marker]:hidden">
        <Columns3 size={15} />
        Customize
      </summary>
      <fieldset className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-card">
        <legend className="sr-only">Visible columns</legend>
        {columns.map((column) => (
          <label
            key={column.id}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-subtle"
          >
            <input
              type="checkbox"
              checked={column.fixed || !hidden.has(column.id)}
              disabled={column.fixed}
              onChange={() => onToggle(column.id)}
            />
            {column.label}
          </label>
        ))}
        <button
          type="button"
          onClick={onReset}
          className="mt-1 w-full rounded-md border-t border-border px-2 pt-2 pb-1 text-left text-xs text-ink-muted hover:text-ink"
        >
          Reset to default
        </button>
      </fieldset>
    </details>
  );
}
