import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listCompanyDeals, listDeals } from '../../api';
import type { DealListItem, DealQueueItem } from '../../types';

import { DealsPanel } from './DealsPanel';

vi.mock('../../api', () => ({
  listCompanyDeals: vi.fn(),
  listDeals: vi.fn(),
  openDeal: vi.fn(),
}));

const COMPANY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function dealRow(overrides: Partial<DealListItem> = {}): DealListItem {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    company_id: COMPANY_ID,
    reference: 'Rotterdam shipment, March',
    stage: 'OPEN',
    buyer_name: null,
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    ...overrides,
  };
}

function renderPanel(isStaff = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DealsPanel customerId={COMPANY_ID} isStaff={isStaff} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The rows now come from the shared Deals read, scoped to the company; the
 * company's own deal route still says whether a deal may be opened. Each test sets
 * the company's deals once, and the queue serves the same ones. */
function asQueueItem(deal: DealListItem): DealQueueItem {
  return {
    ...deal,
    company_name: 'Acme Exports',
    company_journey: 'PROSPECT',
    company_background_check: 'NOT_STARTED',
    buyer_country: null,
    handed_over_at: null,
    po_currency: null,
    po_total: null,
    invoice_count: 0,
    invoiced_total: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDeals).mockImplementation(async (params) => {
    expect(params?.companyId).toBe(COMPANY_ID);
    const company = await vi.mocked(listCompanyDeals).getMockImplementation()?.(COMPANY_ID, {});
    const own = company ?? (await vi.mocked(listCompanyDeals)(COMPANY_ID, {}));
    return {
      deals: own.deals.map(asQueueItem),
      total: own.total,
      limit: 100,
      offset: 0,
      stage_counts: { OPEN: own.total, GATHERING_PAPERWORK: 0, HANDED_OVER: 0, WITHDRAWN: 0 },
    };
  });
  vi.mocked(listCompanyDeals).mockResolvedValue({
    deals: [dealRow()],
    total: 1,
    limit: 50,
    offset: 0,
    can_open_deal: true,
  });
});

describe('DealsPanel', () => {
  it('lists the company deals with their stage', async () => {
    renderPanel();

    await waitFor(() => expect(listCompanyDeals).toHaveBeenCalledWith(COMPANY_ID, {}));
    expect(await screen.findByText('Rotterdam shipment, March')).toBeInTheDocument();
    // The stage chip, inside the row (the table's arrow column is also named "Open").
    expect(within(screen.getByTestId('deal-row')).getByText('Open')).toBeInTheDocument();
    // A deal with no buyer yet says so rather than showing an empty cell.
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });

  it('shows an honest empty state, and invites staff to open the first deal', async () => {
    vi.mocked(listCompanyDeals).mockResolvedValue({
      deals: [],
      total: 0,
      limit: 50,
      offset: 0,
      can_open_deal: true,
    });
    renderPanel();

    expect(await screen.findByText(/No deals yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/Open one when this company has something to finance/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open a deal/ })).toBeInTheDocument();
  });

  it('offers staff no deal on a company the server says is not ready — a LEAD', async () => {
    vi.mocked(listCompanyDeals).mockResolvedValue({
      deals: [],
      total: 0,
      limit: 50,
      offset: 0,
      can_open_deal: false,
    });
    renderPanel(true);

    expect(await screen.findByText(/No deals yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open a deal/ })).not.toBeInTheDocument();
    expect(screen.getByText(/once the company has been qualified/)).toBeInTheDocument();
  });

  it('gives a non-staff viewer no action and no invitation', async () => {
    vi.mocked(listCompanyDeals).mockResolvedValue({
      deals: [],
      total: 0,
      limit: 50,
      offset: 0,
      can_open_deal: false,
    });
    renderPanel(false);

    expect(await screen.findByText(/No deals yet/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Open a deal/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Open one when this company/),
    ).not.toBeInTheDocument();
  });

  it('always offers the way through to the company documents', async () => {
    renderPanel(false);

    const link = await screen.findByRole('link', { name: 'Company documents' });
    // A tab of the company page now, not a page of its own.
    expect(link).toHaveAttribute('href', `/companies/${COMPANY_ID}?tab=documents`);
  });

  it('links each deal to its own page', async () => {
    renderPanel();

    // The reference is the link (the row's arrow opens the same page).
    const link = await screen.findByRole('link', { name: 'Rotterdam shipment, March' });
    expect(link).toHaveAttribute('href', '/deals/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });
});
