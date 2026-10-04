import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrentUser } from '@/platform/auth';

import { createSavedList, getDealSummary, listDeals, listSavedLists, updateSavedList } from '../api';
import type { DealQueue, DealQueueItem, DealSummary, SavedList } from '../types';

import { DealsListPage } from './DealsListPage';

vi.mock('@/platform/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/auth')>()),
  useCurrentUser: vi.fn(),
}));
vi.mock('../api', () => ({
  listDeals: vi.fn(),
  getDealSummary: vi.fn(),
  listSavedLists: vi.fn(),
  createSavedList: vi.fn(),
  updateSavedList: vi.fn(),
  deleteSavedList: vi.fn(),
}));

const ROW: DealQueueItem = {
  id: 'd1',
  company_id: 'c1',
  company_name: 'Acme Exports',
  company_journey: 'PROSPECT',
  company_background_check: 'CLEAR',
  reference: 'Rotterdam order',
  stage: 'GATHERING_PAPERWORK',
  buyer_name: 'Harbour BV',
  buyer_country: 'NL',
  handed_over_at: null,
  po_currency: null,
  po_total: null,
  invoice_count: 0,
  invoiced_total: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
};

const COUNTS = { OPEN: 3, GATHERING_PAPERWORK: 1, HANDED_OVER: 5, WITHDRAWN: 2 };

function queue(deals: DealQueueItem[], total = deals.length): DealQueue {
  return { deals, total, limit: 50, offset: 0, stage_counts: COUNTS };
}

const SUMMARY: DealSummary = {
  period_start: '2026-08-31T00:00:00Z',
  period_end: '2026-09-30T00:00:00Z',
  stage_counts: COUNTS,
  new_leads: 7,
  new_customers: 2,
  deals_opened: 4,
  deals_opened_checks_clear: 3,
  average_turnaround_days: 6.5,
};

function mockRole(role: string) {
  vi.mocked(useCurrentUser).mockReturnValue({
    id: 'u1',
    email: 'user@aner.example',
    full_name: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, role widened for brevity
    role: role as any,
    is_active: true,
  });
}

function renderPage(initialPath = '/deals') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/deals" element={<DealsListPage />} />
          <Route path="/deals/:dealId" element={<p>Deal detail page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastQueueCall() {
  const calls = vi.mocked(listDeals).mock.calls;
  return calls[calls.length - 1]![0]!;
}

describe('DealsListPage', () => {
  beforeEach(() => {
    vi.mocked(listSavedLists).mockReset();
    vi.mocked(listSavedLists).mockResolvedValue({ lists: [], can_create: false });
    vi.mocked(listDeals).mockReset();
    vi.mocked(listDeals).mockResolvedValue(queue([ROW]));
    vi.mocked(getDealSummary).mockResolvedValue(SUMMARY);
    window.localStorage.clear();
    mockRole('OPERATIONS');
  });

  it('shows the rows with the triage fields on them', async () => {
    renderPage();
    const row = await screen.findByTestId('deal-row');
    expect(within(row).getByText('Rotterdam order')).toBeInTheDocument();
    expect(within(row).getByText('Acme Exports')).toBeInTheDocument();
    expect(within(row).getByText('Harbour BV')).toBeInTheDocument();
    expect(within(row).getByText('NL')).toBeInTheDocument();
    expect(within(row).getByText('Gathering paperwork')).toBeInTheDocument();
    expect(within(row).getByText('Clear')).toBeInTheDocument();
    // The company's journey sits under its name.
    expect(within(row).getByText('Prospect')).toBeInTheDocument();
  });

  it('puts the server’s live count on every stage tab', async () => {
    renderPage();
    const tabs = await screen.findByRole('tablist', { name: 'Deal stage' });
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /All deals\s*11/ })).toBeInTheDocument());
    expect(within(tabs).getByRole('tab', { name: /Open\s*3/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Handed over\s*5/ })).toBeInTheDocument();
  });

  it('reads the stage tab from the URL and asks the server for that stage', async () => {
    renderPage('/deals?stage=HANDED_OVER');
    await screen.findByTestId('deal-row');
    expect(lastQueueCall().stages).toEqual(['HANDED_OVER']);
  });

  it('sends the search to the server and starts from the first page', async () => {
    renderPage();
    await screen.findByTestId('deal-row');
    fireEvent.change(screen.getByLabelText('Search deals'), { target: { value: ' Harbour ' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(lastQueueCall()).toMatchObject({ q: 'Harbour', offset: 0 }));
  });

  it('sends the opened-date range to the server with the search', async () => {
    renderPage();
    await screen.findByTestId('deal-row');
    fireEvent.change(screen.getByLabelText('Opened from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Opened to'), { target: { value: '2026-09-15' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(lastQueueCall()).toMatchObject({ openedFrom: '2026-09-01', openedTo: '2026-09-15', offset: 0 }),
    );
  });

  it('refuses a date range that ends before it starts', async () => {
    renderPage();
    await screen.findByTestId('deal-row');
    fireEvent.change(screen.getByLabelText('Opened from'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByLabelText('Opened to'), { target: { value: '2026-09-01' } });
    expect(screen.getByRole('button', { name: 'Filter' })).toBeDisabled();
  });

  it('sorts on the server when a column header is clicked, and flips on a second click', async () => {
    renderPage();
    await screen.findByTestId('deal-row');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Company' }));
    await waitFor(() => expect(lastQueueCall()).toMatchObject({ sort: 'company_name', order: 'asc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Company' }));
    await waitFor(() => expect(lastQueueCall()).toMatchObject({ sort: 'company_name', order: 'desc' }));
  });

  it('opens the deal when its row is clicked', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Harbour BV'));
    expect(await screen.findByText('Deal detail page')).toBeInTheDocument();
  });

  it('hides a column from the picker and remembers it', async () => {
    renderPage();
    await screen.findByTestId('deal-row');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Buyer' }));
    expect(screen.queryByText('Harbour BV')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('aner.deals.hidden-columns')!)).toEqual(
      expect.arrayContaining(['buyer']),
    );
  });

  it('never offers DEVELOPER the background-check column (decision D8)', async () => {
    mockRole('DEVELOPER');
    vi.mocked(listDeals).mockResolvedValue(queue([{ ...ROW, company_background_check: null }]));
    vi.mocked(getDealSummary).mockResolvedValue({ ...SUMMARY, deals_opened_checks_clear: null });
    renderPage();
    await screen.findByTestId('deal-row');
    expect(screen.queryByRole('columnheader', { name: /^Check$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Check' })).not.toBeInTheDocument();
    const bar = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(bar).queryByText('Checks cleared')).toBeNull();
    expect(within(bar).getAllByText('Deals opened').length).toBeGreaterThan(0);
  });

  it('shows FINANCER the background-check column, which underwriting needs', async () => {
    mockRole('FINANCER');
    renderPage();
    const row = await screen.findByTestId('deal-row');
    expect(screen.getByRole('columnheader', { name: /^Check$/ })).toBeInTheDocument();
    expect(within(row).getByText('Clear')).toBeInTheDocument();
  });

  it('renders the KPI bar from the summary, with no open value', async () => {
    renderPage();
    const bar = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(bar).getByText('3 / 4')).toBeInTheDocument();
    expect(within(bar).getByText('6.5 d')).toBeInTheDocument();
    expect(within(bar).getByText('7')).toBeInTheDocument();
    // No tile for it — only the caption saying why it is absent.
    expect(within(bar).queryByText(/^Open value$/i)).toBeNull();
  });

  it('pages through the list using the server’s total', async () => {
    vi.mocked(listDeals).mockResolvedValue(queue([ROW], 120));
    renderPage();
    await screen.findByText(/of 120/);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastQueueCall().offset).toBe(50));
  });

  it('shows an error with a retry when the list fails', async () => {
    vi.mocked(listDeals).mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText("Couldn't load deals.")).toBeInTheDocument();
  });
});

describe('DealsListPage — saved lists (chunk 3)', () => {
  const LIST: SavedList = {
    id: 'l1',
    name: 'Ready to fund',
    object_type: 'DEALS',
    filters: { stages: ['GATHERING_PAPERWORK'], q: 'rotterdam' },
    columns: ['reference', 'amount', 'stage'],
    sort: 'created_at',
    sort_order: 'asc',
    created_by: 'u-admin',
    created_by_name: 'Ada Admin',
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
    can_edit: false,
  };

  beforeEach(() => {
    vi.mocked(listDeals).mockReset();
    vi.mocked(listDeals).mockResolvedValue(queue([ROW]));
    vi.mocked(getDealSummary).mockResolvedValue(SUMMARY);
    window.localStorage.clear();
  });

  it('shows every list to every reader, and opening one applies its view', async () => {
    mockRole('FINANCER');
    vi.mocked(listSavedLists).mockResolvedValue({ lists: [LIST], can_create: false });
    renderPage();
    const group = await screen.findByRole('group', { name: 'Saved lists' });
    fireEvent.click(within(group).getByRole('button', { name: /Ready to fund/ }));

    await waitFor(() =>
      expect(lastQueueCall()).toMatchObject({
        stages: ['GATHERING_PAPERWORK'],
        q: 'rotterdam',
        sort: 'created_at',
        order: 'asc',
      }),
    );
    // The list's columns, not the viewer's own choice.
    expect(screen.queryByRole('columnheader', { name: /Buyer/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toBeInTheDocument();
    // FINANCER builds nothing and changes nothing.
    expect(screen.queryByRole('button', { name: /Save as list|Update list/ })).toBeNull();
  });

  it('opens a list from a link', async () => {
    mockRole('OPERATIONS');
    vi.mocked(listSavedLists).mockResolvedValue({ lists: [LIST], can_create: false });
    renderPage('/deals?list=l1');
    await waitFor(() => expect(lastQueueCall()).toMatchObject({ stages: ['GATHERING_PAPERWORK'], q: 'rotterdam' }));
  });

  it('lets an ADMIN save the current view as a list everyone can open', async () => {
    mockRole('ADMIN');
    vi.mocked(listSavedLists).mockResolvedValue({ lists: [], can_create: true });
    vi.mocked(createSavedList).mockResolvedValue({ ...LIST, id: 'l2', name: 'Big tickets', can_edit: true });
    renderPage('/deals?stage=OPEN');
    await screen.findByTestId('deal-row');
    fireEvent.click(await screen.findByRole('button', { name: /Save as list/ }));
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Big tickets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }));

    await waitFor(() =>
      expect(createSavedList).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Big tickets',
          object_type: 'DEALS',
          filters: { stages: ['OPEN'] },
          sort: 'updated_at',
          sort_order: 'desc',
        }),
      ),
    );
  });

  it('lets the creator update the open list with the current view', async () => {
    mockRole('DEVELOPER');
    vi.mocked(listSavedLists).mockResolvedValue({ lists: [{ ...LIST, can_edit: true }], can_create: true });
    vi.mocked(updateSavedList).mockResolvedValue({ ...LIST, can_edit: true });
    renderPage('/deals?list=l1');
    fireEvent.click(await screen.findByRole('button', { name: /Update list/ }));
    await waitFor(() =>
      expect(updateSavedList).toHaveBeenCalledWith(
        'l1',
        expect.objectContaining({ name: 'Ready to fund', filters: { stages: ['GATHERING_PAPERWORK'], q: 'rotterdam' } }),
      ),
    );
  });

  it('offers OPERATIONS no way to build a list', async () => {
    mockRole('OPERATIONS');
    vi.mocked(listSavedLists).mockResolvedValue({ lists: [], can_create: false });
    renderPage();
    await screen.findByTestId('deal-row');
    expect(screen.queryByRole('button', { name: /Save as list/ })).toBeNull();
  });
});
