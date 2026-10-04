/**
 * The company list — **owner: Developer 2** (L2-14), laid out as Centrex's contact
 * list (Centrex §5, "Operational Workbench").
 *
 * Top to bottom: the status (journey) tabs with live counts and the saved lists
 * (chunk 3) beside the exports and Customize, a filter bar with a label over each control (search, created range,
 * file type, qualification, relationship), the companies this person opened last,
 * then one table: created, file type, business name, PAN, primary contact, cell,
 * email, status, qualification, time in status, and the row's actions.
 *
 * Every filter runs on the server — including the rule that ENDED companies leave
 * the default list and come back for a search or the "Ended" relationship filter;
 * this page does not re-implement it, it just asks. The tab counts honour every
 * filter except the tab.
 *
 * The journey tab lives in the URL (`?journey=PROSPECT`), so the Home page's
 * stage counts can link straight to a filtered list.
 */

import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, History, Phone, Plus, Search, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import {
  Button,
  buttonClasses,
  Card,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  useSearchParamState,
} from '@/components';
import { cn } from '@/lib/cn';
import { isAdminRole, isStaffRole, useCurrentUser } from '@/platform/auth';

import { searchExporterProfiles } from '../api';
import {
  COMPANY_COLUMNS,
  QueueCustomize,
  QueueTable,
  SavedListActions,
  SavedListTabs,
  type CompanyColumnId,
  type ListDefinition,
  type QueueSort,
} from '../components';
import {
  EXPORTER_SOURCE_LABEL,
  JOURNEY_LABEL,
  JOURNEY_STAGES,
  MARKER_LABEL,
  QUALIFICATION_LABEL,
} from '../constants';
import { useExporterProfiles, useSavedLists } from '../hooks';
import { paths } from '../paths';
import { EXPORT_MAX_ROWS, exportQueueCsv, useHiddenColumns } from '../queue-state';
import { useRecentCompanies } from '../recently-viewed';
import type {
  CompanySort,
  ExporterJourney,
  ExporterMarker,
  ExporterProfileListItem,
  ExporterSearchParams,
  ExporterSource,
  QualificationState,
  SavedList,
} from '../types';

type Tab = 'ALL' | ExporterJourney;
const TABS: readonly Tab[] = ['ALL', ...JOURNEY_STAGES];
const SOURCE_OPTIONS = Object.keys(EXPORTER_SOURCE_LABEL) as ExporterSource[];
const QUALIFICATION_OPTIONS = Object.keys(QUALIFICATION_LABEL) as QualificationState[];
const MARKER_OPTIONS = Object.keys(MARKER_LABEL) as ExporterMarker[];
const PAGE_SIZE = 50;
const DEFAULT_SORT: QueueSort<CompanySort> = { sort: 'date_added', order: 'desc' };

interface Filters {
  name: string;
  addedFrom: string;
  addedTo: string;
  source: ExporterSource | '';
  qualification: QualificationState | '';
  marker: ExporterMarker | '';
}
const NO_FILTERS: Filters = { name: '', addedFrom: '', addedTo: '', source: '', qualification: '', marker: '' };

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

/** Centrex's "Recently viewed" bar: the companies this person opened last, from
 * this browser. Nothing at all until they have opened one. */
function RecentlyViewed() {
  const recent = useRecentCompanies();
  if (recent.length === 0) return null;
  return (
    <nav
      aria-label="Recently viewed"
      className="flex items-center gap-2 overflow-x-auto border-b border-border px-5 py-2 text-xs"
    >
      <span className="flex shrink-0 items-center gap-1 font-medium text-ink-muted">
        <History size={13} />
        Recently viewed
      </span>
      {recent.map((item) => (
        <Link
          key={item.id}
          to={paths.company(item.id)}
          className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-0.5 text-ink hover:border-brand-500 hover:text-brand-700"
        >
          {item.name}
        </Link>
      ))}
    </nav>
  );
}

const ACTION =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-sunken hover:text-ink';

/** Call and open. Call opens the company with the call pop-up (Centrex §6: a
 * phone number opens call tracking) — staff log calls; other roles get no call
 * action. The number itself is dialled from the pop-up, where it is unmasked. */
function RowActions({ row, canLogCalls }: { row: ExporterProfileListItem; canLogCalls: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {canLogCalls && (
        <Link
          to={`${paths.company(row.customer_id)}?call=primary`}
          aria-label={`Call ${row.primary_contact_name ?? row.name ?? 'the company'}`}
          title="Log a call"
          className={ACTION}
        >
          <Phone size={15} />
        </Link>
      )}
      <Link
        to={paths.company(row.customer_id)}
        aria-label={`Open ${row.name ?? 'the company'}`}
        className={cn(ACTION, 'opacity-60 group-hover:opacity-100')}
      >
        <ChevronRight size={16} />
      </Link>
    </span>
  );
}

export function ExportersListPage() {
  const { role } = useCurrentUser();
  const [tab, setTabParam] = useSearchParamState<Tab>('journey', TABS, 'ALL');
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [page, setPage] = useState(0);
  const [hidden, toggleColumn, resetColumns] = useHiddenColumns('aner.companies.hidden-columns', COMPANY_COLUMNS);
  const [exporting, setExporting] = useState<'view' | 'full' | null>(null);

  // ── Saved lists (chunk 3): `?list=<id>` in the URL, so a list can be linked to ──
  const [searchParams, setSearchParams] = useSearchParams();
  const activeListId = searchParams.get('list');
  const savedLists = useSavedLists('COMPANIES').data?.lists ?? [];
  const activeList = savedLists.find((list) => list.id === activeListId) ?? null;
  /** A list's own status filter — in place of the status tab. */
  const [listJourney, setListJourney] = useState<ExporterJourney | null>(null);
  /** A list's columns while it is open; Customize edits these, not the personal set. */
  const [columnOverride, setColumnOverride] = useState<string[] | null>(null);
  const appliedListRef = useRef<string | null>(null);

  const applyList = useCallback(
    (list: SavedList) => {
      appliedListRef.current = list.id;
      const saved = list.filters as Partial<{
        name: string;
        journey: ExporterJourney;
        qualification: QualificationState;
        marker: ExporterMarker;
        source: ExporterSource;
        added_from: string;
        added_to: string;
      }>;
      const next: Filters = {
        name: saved.name ?? '',
        addedFrom: saved.added_from ?? '',
        addedTo: saved.added_to ?? '',
        source: saved.source ?? '',
        qualification: saved.qualification ?? '',
        marker: saved.marker ?? '',
      };
      setDraft(next);
      setApplied(next);
      setListJourney(saved.journey ?? null);
      setSort(
        list.sort ? { sort: list.sort as CompanySort, order: (list.sort_order as 'asc' | 'desc') ?? 'desc' } : DEFAULT_SORT,
      );
      setColumnOverride(list.columns.length ? list.columns : null);
      setPage(0);
      setSearchParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.set('list', list.id);
          updated.delete('journey');
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const leaveList = () => {
    appliedListRef.current = null;
    setListJourney(null);
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

  const visible = useMemo(
    () =>
      COMPANY_COLUMNS.filter(
        (column) =>
          column.fixed || (columnOverride ? columnOverride.includes(column.id) : !hidden.has(column.id)),
      ),
    [hidden, columnOverride],
  );
  const shownHidden = useMemo(
    () =>
      columnOverride
        ? new Set(COMPANY_COLUMNS.filter((c) => !columnOverride.includes(c.id)).map((c) => c.id))
        : hidden,
    [columnOverride, hidden],
  );
  const toggleShown = (id: CompanyColumnId) => {
    if (!columnOverride) return toggleColumn(id);
    setColumnOverride((current) =>
      current?.includes(id) ? current.filter((c) => c !== id) : [...(current ?? []), id],
    );
  };

  const filters: ExporterSearchParams = {
    name: applied.name || undefined,
    journey: activeList ? (listJourney ?? undefined) : tab === 'ALL' ? undefined : tab,
    qualification: applied.qualification || undefined,
    marker: applied.marker || undefined,
    source: applied.source || undefined,
    addedFrom: applied.addedFrom || undefined,
    addedTo: applied.addedTo || undefined,
    sort: sort.sort,
    order: sort.order,
  };
  const { data, isLoading, isError, isFetching, refetch } = useExporterProfiles({
    ...filters,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const profiles = data?.profiles ?? [];
  const total = data?.total;
  const counts = data?.journey_counts;
  const allCount = counts ? Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0) : undefined;
  const filtered = Object.values(applied).some(Boolean) || tab !== 'ALL';
  const drafted = Object.values(draft).some(Boolean);
  const rangeInvalid = Boolean(draft.addedFrom && draft.addedTo && draft.addedFrom > draft.addedTo);
  const firstRow = profiles.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = page * PAGE_SIZE + profiles.length;
  // With a total, page by it; without one (an older server), a full page means
  // "there may be more".
  const hasNextPage = total !== undefined ? lastRow < total : profiles.length === PAGE_SIZE;

  // Any change of filter starts again from the first page. A status tab leaves any
  // open saved list.
  const setTab = (value: Tab) => {
    if (activeList) leaveList();
    setTabParam(value);
    setPage(0);
  };

  /** The view as it stands — what "Save as list" and "Update list" capture. */
  const currentDefinition = (): ListDefinition => ({
    filters: {
      ...(applied.name ? { name: applied.name } : {}),
      ...(filters.journey ? { journey: filters.journey } : {}),
      ...(applied.qualification ? { qualification: applied.qualification } : {}),
      ...(applied.marker ? { marker: applied.marker } : {}),
      ...(applied.source ? { source: applied.source } : {}),
      ...(applied.addedFrom ? { added_from: applied.addedFrom } : {}),
      ...(applied.addedTo ? { added_to: applied.addedTo } : {}),
    },
    columns: visible.map((column) => column.id),
    sort: sort.sort,
    sort_order: sort.order,
  });

  const exportCsv = async (kind: 'view' | 'full') => {
    setExporting(kind);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const scope = tab === 'ALL' ? 'all' : tab.toLowerCase();
      const count = await exportQueueCsv(
        `companies-${scope}-${kind === 'full' ? 'full-' : ''}${stamp}.csv`,
        kind === 'view' ? visible : COMPANY_COLUMNS,
        async (limit, offset) => {
          const result = await searchExporterProfiles({ ...filters, limit, offset });
          return { rows: result.profiles, total: result.total ?? result.profiles.length };
        },
      );
      if (count >= EXPORT_MAX_ROWS) {
        toast.message(`Exported the first ${EXPORT_MAX_ROWS} companies. Narrow the filter for the rest.`);
      }
    } catch {
      toast.error("Couldn't export the companies. Try again.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every company and who to call there. Ended relationships are hidden unless you search for them or filter by “Ended”."
        actions={
          <>
            <Link to={paths.importCompanies} className={buttonClasses()}>
              <Upload size={15} />
              Import CSV
            </Link>
            {/* The server admits ADMIN only: intake records a decision as RXIL's. */}
            {isAdminRole(role) && (
              <Link to={paths.rxilIntake} className={buttonClasses()}>
                RXIL intake
              </Link>
            )}
            <Link to={paths.newCompany} className={buttonClasses({ variant: 'primary' })}>
              <Plus size={15} />
              Add company
            </Link>
          </>
        }
      />

      <Card className="overflow-hidden">
        {/* ── Status tabs, with the exports and Customize on the right ── */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Tabs value={activeList ? '' : tab} onValueChange={(value) => setTab(value as Tab)} variant="pill">
            <TabsList aria-label="Journey stage" className="flex flex-wrap gap-1 bg-transparent p-0">
              {TABS.map((value) => {
                const count = value === 'ALL' ? allCount : counts?.[value];
                return (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="rounded-full border border-transparent px-2.5 py-1 text-[13px] data-[state=active]:border-brand-500 data-[state=active]:shadow-none"
                  >
                    {value === 'ALL' ? 'All' : JOURNEY_LABEL[value]}
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
          <SavedListTabs objectType="COMPANIES" activeId={activeList?.id ?? null} onSelect={applyList} />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <SavedListActions
              objectType="COMPANIES"
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
              disabled={exporting !== null || profiles.length === 0}
              title="Export current view — the columns on screen, for every company this filter matches"
            >
              <Download size={15} />
              {exporting === 'view' ? 'Exporting…' : 'Export view'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void exportCsv('full')}
              disabled={exporting !== null || profiles.length === 0}
              title="Export full report — every column, for every company this filter matches"
            >
              <FileSpreadsheet size={15} />
              {exporting === 'full' ? 'Exporting…' : 'Full report'}
            </Button>
            <QueueCustomize
              columns={COMPANY_COLUMNS}
              hidden={shownHidden}
              onToggle={toggleShown}
              onReset={() => (columnOverride ? setColumnOverride(null) : resetColumns())}
            />
          </div>
        </div>

        {/* ── Filter bar — Centrex's: a label over each control ── */}
        <form
          role="search"
          className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-border bg-surface-subtle/60 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (rangeInvalid) return;
            setApplied({ ...draft, name: draft.name.trim() });
            setPage(0);
          }}
        >
          <FilterField label="Search">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Input
                type="search"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Company or contact name"
                aria-label="Search by company or contact name"
                className="h-8 pl-9 sm:w-60"
              />
            </div>
          </FilterField>
          <FilterField label="Created">
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Input
                type="date"
                value={draft.addedFrom}
                max={draft.addedTo || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, addedFrom: e.target.value }))}
                aria-label="Created from"
                className="h-8 w-[8.75rem]"
              />
              <span>to</span>
              <Input
                type="date"
                value={draft.addedTo}
                min={draft.addedFrom || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, addedTo: e.target.value }))}
                aria-label="Created to"
                className="h-8 w-[8.75rem]"
              />
            </div>
          </FilterField>
          <FilterField label="File type">
            <Select
              aria-label="File type"
              value={draft.source}
              onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value as ExporterSource | '' }))}
              className="h-8 w-32 py-0"
            >
              <option value="">Any</option>
              {SOURCE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {EXPORTER_SOURCE_LABEL[value]}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Qualification">
            <Select
              aria-label="Qualification"
              value={draft.qualification}
              onChange={(e) =>
                setDraft((d) => ({ ...d, qualification: e.target.value as QualificationState | '' }))
              }
              className="h-8 w-32 py-0"
            >
              <option value="">Any</option>
              {QUALIFICATION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {QUALIFICATION_LABEL[value]}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Relationship">
            <Select
              aria-label="Relationship"
              value={draft.marker}
              onChange={(e) => setDraft((d) => ({ ...d, marker: e.target.value as ExporterMarker | '' }))}
              className="h-8 w-32 py-0"
              title="Ended companies are hidden unless you search or pick Ended"
            >
              <option value="">Any</option>
              {MARKER_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {MARKER_LABEL[value]}
                </option>
              ))}
            </Select>
          </FilterField>
          <div className="flex items-center gap-1">
            <Button type="submit" size="sm" variant="primary" disabled={rangeInvalid}>
              Filter
            </Button>
            {(Object.values(applied).some(Boolean) || drafted) && (
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
          </div>
        </form>

        <RecentlyViewed />

        {isError ? (
          <ErrorState title="Couldn't load companies." className="m-5" onRetry={() => void refetch()}>
            Check your connection and try again.
          </ErrorState>
        ) : (
          <QueueTable
            rows={profiles}
            columns={visible}
            rowKey={(row) => row.customer_id}
            rowHref={(row) => paths.company(row.customer_id)}
            endLabel={{ text: 'Actions', visible: true }}
            endCell={(row) => <RowActions row={row} canLogCalls={isStaffRole(role)} />}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(0);
            }}
            isLoading={isLoading}
            rowTestId="company-row"
            empty={
              filtered ? (
                'No companies match this filter.'
              ) : (
                <>
                  No companies yet —{' '}
                  <Link to={paths.newCompany} className="font-medium text-brand-600 underline">
                    Add company
                  </Link>
                </>
              )
            }
          />
        )}

        {!isError && (page > 0 || hasNextPage || (total ?? 0) > 0) && (
          <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-ink-muted">
            <span className="tabular-nums">
              {total !== undefined ? `Showing ${firstRow}–${lastRow} of ${total}` : `Page ${page + 1}`}
              {isFetching && !isLoading ? ' · updating…' : ''}
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
              <Button
                size="sm"
                variant="ghost"
                aria-label="Next page"
                disabled={!hasNextPage}
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
