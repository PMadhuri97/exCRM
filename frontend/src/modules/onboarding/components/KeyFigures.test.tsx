import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDealSummary } from '../api';
import type { DealSummary } from '../types';

import { KeyFigures } from './KeyFigures';

vi.mock('../api', () => ({ getDealSummary: vi.fn() }));

const SUMMARY: DealSummary = {
  period_start: '2026-08-31T00:00:00Z',
  period_end: '2026-09-30T00:00:00Z',
  stage_counts: { OPEN: 3, GATHERING_PAPERWORK: 1, HANDED_OVER: 5, WITHDRAWN: 2 },
  new_leads: 7,
  new_customers: 2,
  deals_opened: 4,
  deals_opened_checks_clear: 3,
  average_turnaround_days: 6.5,
};

function renderFigures(linked = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KeyFigures linked={linked} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KeyFigures', () => {
  beforeEach(() => {
    vi.mocked(getDealSummary).mockReset();
    vi.mocked(getDealSummary).mockResolvedValue(SUMMARY);
  });

  it('shows the server’s figures, with no open value', async () => {
    renderFigures();
    const strip = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(strip).getByText('4')).toBeInTheDocument(); // live: 3 open + 1 gathering
    expect(within(strip).getByText('3 / 4')).toBeInTheDocument();
    expect(within(strip).getByText('6.5 d')).toBeInTheDocument();
    expect(within(strip).queryByText(/^Open value$/i)).toBeNull();
    expect(within(strip).queryAllByRole('link')).toHaveLength(0);
  });

  it('on Home, each figure opens the list it counts', async () => {
    renderFigures(true);
    const strip = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(strip).getByRole('link', { name: /Live deals/ })).toHaveAttribute('href', '/deals');
    expect(within(strip).getByRole('link', { name: /New leads/ })).toHaveAttribute('href', '/companies?journey=LEAD');
    expect(within(strip).getByRole('link', { name: /New customers/ })).toHaveAttribute(
      'href',
      '/companies?journey=CUSTOMER',
    );
  });

  it('names the figure for a role refused the background check (D8)', async () => {
    vi.mocked(getDealSummary).mockResolvedValue({ ...SUMMARY, deals_opened_checks_clear: null });
    renderFigures();
    const strip = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(strip).queryByText('Checks cleared')).toBeNull();
    expect(within(strip).getByText('Deals opened')).toBeInTheDocument();
  });

  it('shows no numbers at all when the summary fails — a zero would be a claim', async () => {
    vi.mocked(getDealSummary).mockRejectedValue(new Error('down'));
    const { container } = renderFigures();
    await vi.waitFor(() => expect(getDealSummary).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('region', { name: 'Key figures' })).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });
});
