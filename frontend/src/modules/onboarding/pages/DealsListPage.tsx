/**
 * The Deals list — build prompt chunk 1; Centrex §4 ("Dynamic List Builder /
 * Work Queues") and §5 ("Contact List / Operational Workbench").
 *
 * The operational home base between tasks. Laid out the way Centrex lays out its
 * deals screen, top to bottom: the key figures, the queues as tabs with live
 * counts beside the two exports and Customize, a filter bar (search and an
 * opened-date range), then one wide table that never wraps.
 * "Deal" is the word on screen; in code a deal stays a `Deal`.
 *
 * **Everything is computed on the server** — filtering, search, dates, sorting,
 * the tab counts and every figure — so this page asks and renders. The tab
 * counts honour the search and dates but not the tab, so a tab says how many
 * rows it would show before it is picked; rows move between tabs on their own
 * when a stage changes, which is Centrex's "live work queue", not a report.
 *
 * **Not here yet, on purpose.** No open value or money columns: a deal holds no
 * amount until the PO/invoice work (chunk 2). No bulk assignment: a deal has no
 * assignee. Neither is faked in the meantime. Saved lists (chunk 3) join the
 * queue tabs, in this same bar.
 */

import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import {
  Button,
  Card,
  ErrorState,
  Input,
  PageHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  useSearchParamState,
} from '@/components';
import { cn } from '@/lib/cn';
import { canReadUnderwriting, useCurrentUser } from '@/platform/auth';

import { listDeals } from '../api';
import {
  DEAL_COLUMNS,
  DealsTable,
  KeyFigures,
  QueueCustomize,
  SavedListActions,
  SavedListTabs,
  type DealColumnId,
  type DealsSort,
  type ListDefinition,
} from '../components';
import { DEAL_STAGE_LABEL, DEAL_STAGES } from '../constants';
import { useDealQueue, useSavedLists } from '../hooks';
import { EXPORT_MAX_ROWS, exportQueueCsv, useHiddenColumns } from '../queue-state';
import type { DealQueueParams, DealQueueSort, DealStage, SavedList } from '../types';

type Tab = 'ALL' | DealStage;
const TABS: readonly Tab[] = ['ALL', ...DEAL_STAGES];
const PAGE_SIZE = 50;
const DEFAULT_SORT: DealsSort = { sort: 'updated_at', order: 'desc' };

// ── The page ─────────────────────────────────────────────────────────────────

interface Filters {
  q: string;
  openedFrom: string;
  openedTo: string;
}
const NO_FILTERS: Filters = { q: '', openedFrom: '', openedTo: '' };

export function DealsListPage() {
  const { role } = useCurrentUser();
  const [tab, setTabParam] = useSearchParamState<Tab>('stage', TABS, 'ALL');
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<DealsSort>(DEFAULT_SORT);
  const [page, setPage] = useState(0);
  const [hidden, toggleColumn, resetColumns] = useHiddenColumns('aner.deals.hidden-columns', DEAL_COLUMNS);
  const [exporting, setExporting] = useState<'view' | 'full' | null>(null);

  // ── Saved lists (chunk 3): `?list=<id>` in the URL, so a list can be linked to ──
  const [searchParams, setSearchParams] = useSearchParams();
  const activeListId = searchParams.get('list');
  const savedLists = useSavedLists('DEALS').data?.lists ?? [];
  const activeList = savedLists.find((list) => list.id === activeListId) ?? null;
  /** A list's own stages (it may hold several) — in place of the stage tab. */
  const [listStages, setListStages] = useState<DealStage[] | null>(null);
  /** A list's columns while it is open; Customize edits these, not the personal set. */
  const [columnOverride, setColumnOverride] = useState<string[] | null>(null);
  const appliedListRef = useRef<string | null>(null);

  const applyList = useCallback(
    (list: SavedList) => {
      appliedListRef.current = list.id;
      const saved = list.filters as {
        stages?: DealStage[];
        q?: string;
        opened_from?: string;
        opened_to?: string;
      };
      const next: Filters = {
        q: saved.q ?? '',
        openedFrom: saved.opened_from ?? '',
        openedTo: saved.opened_to ?? '',
      };
      setDraft(next);
      setApplied(next);
      setListStages(saved.stages?.length ? saved.stages : null);
      setSort(
        list.sort ? { sort: list.sort as DealQueueSort, order: (list.sort_order as 'asc' | 'desc') ?? 'desc' } : DEFAULT_SORT,
      );
      setColumnOverride(list.columns.length ? list.columns : null);
      setPage(0);
      setSearchParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.set('list', list.id);
          updated.delete('stage');
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const leaveList = () => {
    appliedListRef.current = null;
    setListStages(null);
    setColumnOverride(null);
    setSearchParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.delete('list');
        return updated;
      },
      { replace: true },
    );
  };

  // A list opened from a link is applied once it has loaded.
  useEffect(() => {
    if (activeList && appliedListRef.current !== activeList.id) applyList(activeList);
  }, [activeList, applyList]);

  // DEVELOPER is never offered the background-check column (decision D8); the
  // server sends it no value either.
  const available = useMemo(
    () => DEAL_COLUMNS.filter((column) => !column.underwritingOnly || canReadUnderwriting(role)),
    [role],
  );
  const visible = available.filter((column) =>
    column.fixed || (columnOverride ? columnOverride.includes(column.id) : !hidden.has(column.id)),
  );
  const shownHidden = useMemo(
    () =>
      columnOverride
        ? new Set(available.filter((c) => !columnOverride.includes(c.id)).map((c) => c.id))
        : hidden,
    [available, columnOverride, hidden],
  );
  const toggleShown = (id: DealColumnId) => {
    if (!columnOverride) return toggleColumn(id);
    setColumnOverride((current) =>
      current?.includes(id) ? current.filter((c) => c !== id) : [...(current ?? []), id],
    );
  };

  const filters: DealQueueParams = {
    stages: activeList ? (listStages ?? undefined) : tab === 'ALL' ? undefined : [tab],
    q: applied.q || undefined,
    openedFrom: applied.openedFrom || undefined,
    openedTo: applied.openedTo || undefined,
    sort: sort.sort,
    order: sort.order,
  };
  const queue = useDealQueue({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE });

  const rows = queue.data?.deals ?? [];
  const total = queue.data?.total ?? 0;
  const counts = queue.data?.stage_counts;
  const allCount = counts
    ? Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0)
    : undefined;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = page * PAGE_SIZE + rows.length;
  const filtered = Object.values(applied).some(Boolean);
  const drafted = Object.values(draft).some(Boolean);
  const rangeInvalid = Boolean(draft.openedFrom && draft.openedTo && draft.openedFrom > draft.openedTo);

  // Any change of filter starts again from the first page. A stage tab leaves any
  // open saved list.
  const setTab = (value: Tab) => {
    if (activeList) leaveList();
    setTabParam(value);
    setPage(0);
  };

  /** The view as it stands — what "Save as list" and "Update list" capture. */
  const currentDefinition = (): ListDefinition => ({
    filters: {
      ...(filters.stages?.length ? { stages: filters.stages } : {}),
      ...(applied.q ? { q: applied.q } : {}),
      ...(applied.openedFrom ? { opened_from: applied.openedFrom } : {}),
      ...(applied.openedTo ? { opened_to: applied.openedTo } : {}),
    },
    columns: visible.map((column) => column.id),
    sort: sort.sort,
    sort_order: sort.order,
  });

  const exportCsv = async (kind: 'view' | 'full') => {
    setExporting(kind);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const scope = activeList
        ? activeList.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : tab === 'ALL'
          ? 'all'
          : tab.toLowerCase();
      // The current view is what's on screen; the full report is every column
      // this viewer may see, for the same rows.
      const count = await exportQueueCsv(
        `deals-${scope}-${kind === 'full' ? 'full-' : ''}${stamp}.csv`,
        kind === 'view' ? visible : available,
        async (limit, offset) => {
          const page = await listDeals({ ...filters, limit, offset });
          return { rows: page.deals, total: page.total };
        },
      );
      if (count >= EXPORT_MAX_ROWS) {
        toast.message(`Exported the first ${EXPORT_MAX_ROWS} deals. Narrow the filter for the rest.`);
      }
    } catch {
      toast.error("Couldn't export the deals. Try again.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Deals"
        description="Every company’s deals in one queue. Rows move between stages on their own as the work moves."
      />

      <KeyFigures className="mb-5" />

      <Card className="overflow-hidden">
        {/* ── Queues, with the exports and Customize on the right ── */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Tabs value={activeList ? '' : tab} onValueChange={(value) => setTab(value as Tab)} variant="pill">
            <TabsList aria-label="Deal stage" className="flex flex-wrap gap-1 bg-transparent p-0">
              {TABS.map((value) => {
                const count = value === 'ALL' ? allCount : counts?.[value];
                return (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="rounded-full border border-transparent px-2.5 py-1 text-[13px] data-[state=active]:border-brand-500 data-[state=active]:shadow-none"
                  >
                    {value === 'ALL' ? 'All deals' : DEAL_STAGE_LABEL[value]}
                    {count !== undefined && (
                      <span
                        className={cn(
                          'min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums',
                          value === tab
                            ? 'bg-brand-500 text-white dark:text-surface'
                            : 'bg-surface-sunken text-ink-muted',
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <SavedListTabs objectType="DEALS" activeId={activeList?.id ?? null} onSelect={applyList} />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <SavedListActions
              objectType="DEALS"
              active={activeList}
              currentDefinition={currentDefinition}
              onSaved={applyList}
              onDeleted={() => {
                leaveList();
                setTabParam('ALL');
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void exportCsv('view')}
              disabled={exporting !== null || total === 0}
              title="Export current view — the columns on screen, for every row this filter matches"
            >
              <Download size={15} />
              {exporting === 'view' ? 'Exporting…' : 'Export view'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void exportCsv('full')}
              disabled={exporting !== null || total === 0}
              title="Export full report — every column you may see, for every row this filter matches"
            >
              <FileSpreadsheet size={15} />
              {exporting === 'full' ? 'Exporting…' : 'Full report'}
            </Button>
            <QueueCustomize
              columns={available}
              hidden={shownHidden}
              onToggle={toggleShown}
              onReset={() => (columnOverride ? setColumnOverride(null) : resetColumns())}
            />
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="border-b border-border bg-surface-subtle/60 px-5 py-2.5">
          <form
            role="search"
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (rangeInvalid) return;
              setApplied({ ...draft, q: draft.q.trim() });
              setPage(0);
            }}
          >
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Input
                type="search"
                value={draft.q}
                onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                placeholder="Search deal, company or buyer"
                aria-label="Search deals"
                className="h-8 pl-9 sm:w-80"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span>Opened</span>
              <Input
                type="date"
                value={draft.openedFrom}
                max={draft.openedTo || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, openedFrom: e.target.value }))}
                aria-label="Opened from"
                className="h-8 w-[9.5rem]"
              />
              <span>to</span>
              <Input
                type="date"
                value={draft.openedTo}
                min={draft.openedFrom || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, openedTo: e.target.value }))}
                aria-label="Opened to"
                className="h-8 w-[9.5rem]"
              />
            </div>
            <Button type="submit" size="sm" variant="primary" disabled={rangeInvalid}>
              Filter
            </Button>
            {(filtered || drafted) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(NO_FILTERS);
                  setApplied(NO_FILTERS);
                  setPage(0);
                }}
              >
                <X size={14} />
                Clear
              </Button>
            )}
          </form>
        </div>

        {/* ── The table ── */}
        {queue.isError ? (
          <ErrorState title="Couldn't load deals." className="m-5" onRetry={() => void queue.refetch()}>
            Check your connection and try again.
          </ErrorState>
        ) : (
          <DealsTable
            rows={rows}
            columns={visible}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(0);
            }}
            isLoading={queue.isLoading}
            empty={
              filtered || tab !== 'ALL'
                ? 'No deals match this filter.'
                : 'No deals yet. They are opened from a company’s page once it is a prospect.'
            }
          />
        )}

        {!queue.isError && total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-ink-muted">
            <span className="tabular-nums">
              Showing {firstRow}–{lastRow} of {total}
              {queue.isFetching && !queue.isLoading ? ' · updating…' : ''}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={15} />
              </Button>
              <span className="px-1 tabular-nums">
                Page {page + 1} of {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Next page"
                disabled={lastRow >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
