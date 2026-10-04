import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrentUser } from '@/platform/auth';

import { listSavedLists, searchExporterProfiles } from '../api';
import type { ExporterProfileListItem } from '../types';

import { rememberCompany } from '../recently-viewed';

import { ExportersListPage } from './ExportersListPage';

// vitest hoists vi.mock calls above every import in this file automatically
// (its esbuild transform, not declaration order), so these apply regardless
// of being written after the imports they replace.
// Partial: the role helpers (`isStaffRole`, …) stay real, only the session is faked.
vi.mock('@/platform/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/auth')>()),
  useCurrentUser: vi.fn(),
}));
vi.mock('../api', () => ({
  searchExporterProfiles: vi.fn(),
  listSavedLists: vi.fn(async () => ({ lists: [], can_create: false })),
  createSavedList: vi.fn(),
  updateSavedList: vi.fn(),
  deleteSavedList: vi.fn(),
}));

const PROFILE: ExporterProfileListItem = {
  customer_id: 'c1',
  name: 'Acme Exports',
  country: 'IN',
  gstins: ['27ABCDE1234F1Z5'],
  cin: null,
  journey: 'LEAD',
  qualification: 'NOT_YET_REVIEWED',
  marker: 'NONE',
  marker_reason: null,
  pan: 'ABCDE1234F',
  iec: null,
  source: 'MANUAL',
  relationship_manager: 'Jane RM',
  relationship_manager_user_id: 'user-owner',
  industry: null,
  year_established: null,
  date_added: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function mockUser(role: string, id: string) {
  vi.mocked(useCurrentUser).mockReturnValue({
    id,
    email: 'user@aner.example',
    full_name: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, role widened for brevity
    role: role as any,
    is_active: true,
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExportersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExportersListPage — PAN/GSTIN masking (EXP-F2 acceptance criterion)', () => {
  beforeEach(() => {
    vi.mocked(searchExporterProfiles).mockResolvedValue({
      profiles: [PROFILE],
      limit: 100,
      offset: 0,
    });
  });

  // Decision 12: OPERATIONS sees masked tax IDs whether or not it is the
  // assigned relationship manager. The second case below used to assert the
  // opposite for an owner; both ownership states now have the same answer, so
  // the owner case asserts that rather than being dropped.
  it('masks PAN for OPERATIONS on an exporter they do not own', async () => {
    mockUser('OPERATIONS', 'someone-else');
    renderPage();
    expect(await screen.findByText('Acme Exports')).toBeInTheDocument();
    expect(screen.getByText('••••••234F')).toBeInTheDocument();
    expect(screen.queryByText('ABCDE1234F')).not.toBeInTheDocument();
  });

  it('still masks PAN for OPERATIONS on an exporter they do own', async () => {
    mockUser('OPERATIONS', 'user-owner');
    renderPage();
    expect(await screen.findByText('Acme Exports')).toBeInTheDocument();
    expect(screen.getByText('••••••234F')).toBeInTheDocument();
    expect(screen.queryByText('ABCDE1234F')).not.toBeInTheDocument();
  });

  it('never masks PAN for COMPLIANCE', async () => {
    mockUser('COMPLIANCE', 'someone-else');
    renderPage();
    expect(await screen.findByText('Acme Exports')).toBeInTheDocument();
    expect(screen.getByText('ABCDE1234F')).toBeInTheDocument();
  });
});

describe('ExportersListPage — the journey, qualification and marker filters (L2-14)', () => {
  beforeEach(() => {
    mockUser('OPERATIONS', 'someone-else');
    vi.mocked(searchExporterProfiles).mockReset();
    vi.mocked(searchExporterProfiles).mockResolvedValue({
      profiles: [{ ...PROFILE, marker: 'PAUSED', marker_reason: 'Seasonal' }],
      limit: 100,
      offset: 0,
    });
  });

  it('shows the journey, qualification and marker as three separate chips', async () => {
    renderPage();
    expect(await screen.findByText('Acme Exports')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByTestId('journey-chip')).toHaveTextContent('Lead');
    expect(within(table).getByText('Not yet reviewed')).toBeInTheDocument();
    expect(within(table).getByText('Paused')).toBeInTheDocument();
  });

  it('asks the server for one journey stage when a tab is chosen', async () => {
    renderPage();
    await screen.findByText('Acme Exports');
    fireEvent.click(screen.getByRole('tab', { name: 'Prospect' }));
    await waitFor(() =>
      expect(searchExporterProfiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ journey: 'PROSPECT' }),
      ),
    );
  });

  it('passes the qualification and marker filters to the server rather than filtering here', async () => {
    renderPage();
    await screen.findByText('Acme Exports');
    fireEvent.change(screen.getByRole('combobox', { name: 'Qualification' }), { target: { value: 'QUALIFIED' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Relationship' }), { target: { value: 'ENDED' } });
    // Centrex's filter bar: nothing is asked until Filter is pressed.
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(searchExporterProfiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ qualification: 'QUALIFIED', marker: 'ENDED' }),
      ),
    );
  });

  it('offers no lifecycle status filter and sends no status parameter', async () => {
    renderPage();
    await screen.findByText('Acme Exports');
    for (const [params] of vi.mocked(searchExporterProfiles).mock.calls) {
      expect(params).not.toHaveProperty('status');
    }
    expect(screen.queryByText(/compliance review/i)).not.toBeInTheDocument();
  });
});

describe('ExportersListPage — RXIL intake link', () => {
  beforeEach(() => {
    vi.mocked(searchExporterProfiles).mockResolvedValue({ profiles: [], limit: 100, offset: 0 });
  });

  it('offers RXIL intake to ADMIN', () => {
    mockUser('ADMIN', 'user-admin');
    renderPage();
    expect(screen.getByRole('link', { name: 'RXIL intake' })).toBeInTheDocument();
  });

  it.each(['OPERATIONS', 'COMPLIANCE', 'DEVELOPER'])(
    'does not offer RXIL intake to %s, whom the server refuses',
    (role) => {
      mockUser(role, 'user-1');
      renderPage();
      expect(screen.queryByRole('link', { name: 'RXIL intake' })).not.toBeInTheDocument();
    },
  );
});

describe('ExportersListPage — the contact-list layout (Centrex §5)', () => {
  const WITH_CONTACT: ExporterProfileListItem = {
    ...PROFILE,
    source: 'RXIL',
    status_since: '2026-08-01T00:00:00Z',
    primary_contact_name: 'Meera Iyer',
    primary_contact_email: 'm•••@acme.example',
    primary_contact_phone: '••••2345',
  };

  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(searchExporterProfiles).mockReset();
    vi.mocked(searchExporterProfiles).mockResolvedValue({
      profiles: [WITH_CONTACT],
      limit: 50,
      offset: 0,
      total: 1,
      journey_counts: { LEAD: 1, PROSPECT: 4, CUSTOMER: 2 },
    });
  });

  it('shows who to call and where the company stands on the row', async () => {
    mockUser('OPERATIONS', 'someone-else');
    renderPage();
    const row = await screen.findByTestId('company-row');
    expect(within(row).getByText('RXIL')).toBeInTheDocument();
    expect(within(row).getByText('Meera Iyer')).toBeInTheDocument();
    expect(within(row).getByText('••••2345')).toBeInTheDocument();
    expect(within(row).getByTitle(/^Since /)).toHaveTextContent(/^\d+ days?$/);
  });

  it('puts the server’s count on every status tab', async () => {
    mockUser('OPERATIONS', 'someone-else');
    renderPage();
    const tabs = await screen.findByRole('tablist', { name: 'Journey stage' });
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /All\s*7/ })).toBeInTheDocument());
    expect(within(tabs).getByRole('tab', { name: /Prospect\s*4/ })).toBeInTheDocument();
  });

  it('offers email and call only where the contact reached this viewer unmasked', async () => {
    mockUser('COMPLIANCE', 'someone-else');
    vi.mocked(searchExporterProfiles).mockResolvedValue({
      profiles: [
        { ...WITH_CONTACT, primary_contact_email: 'meera@acme.example', primary_contact_phone: '+91 98200 12345' },
      ],
      limit: 50,
      offset: 0,
      total: 1,
    });
    renderPage();
    const row = await screen.findByTestId('company-row');
    expect(within(row).getByRole('link', { name: 'Email Meera Iyer' })).toHaveAttribute('href', 'mailto:meera@acme.example');
    // The call icon opens the company with the call pop-up (Centrex §6).
    expect(within(row).getByRole('link', { name: 'Call Meera Iyer' })).toHaveAttribute('href', '/companies/c1?call=primary');
  });

  it('dims email for a role that sees it masked, but still lets staff log a call', async () => {
    mockUser('OPERATIONS', 'someone-else');
    renderPage();
    const row = await screen.findByTestId('company-row');
    expect(within(row).queryByRole('link', { name: /^Email/ })).toBeNull();
    expect(within(row).getByRole('link', { name: 'Call Meera Iyer' })).toBeInTheDocument();
  });

  it('gives FINANCER and DEVELOPER no call action — they read, they do not log calls', async () => {
    for (const role of ['FINANCER', 'DEVELOPER']) {
      mockUser(role, 'someone-else');
      const { unmount } = renderPage();
      const row = await screen.findByTestId('company-row');
      expect(within(row).queryByRole('link', { name: /^Call/ })).toBeNull();
      unmount();
    }
  });

  it('sends the created range, file type and sort to the server', async () => {
    mockUser('OPERATIONS', 'someone-else');
    renderPage();
    await screen.findByTestId('company-row');
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Created to'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'File type' }), { target: { value: 'RXIL' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(searchExporterProfiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ addedFrom: '2026-09-01', addedTo: '2026-09-15', source: 'RXIL' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Time in status' }));
    await waitFor(() =>
      expect(searchExporterProfiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'status_since', order: 'asc' }),
      ),
    );
  });

  it('shows the companies this viewer opened last', async () => {
    mockUser('OPERATIONS', 'someone-else');
    rememberCompany({ id: 'c9', name: 'Recently opened exporter' });
    renderPage();
    const bar = await screen.findByRole('navigation', { name: 'Recently viewed' });
    expect(within(bar).getByRole('link', { name: 'Recently opened exporter' })).toHaveAttribute('href', '/companies/c9');
  });
});

describe('ExportersListPage — saved lists (chunk 3)', () => {
  it('opening a list applies its status, filters and sort', async () => {
    mockUser('COMPLIANCE', 'someone-else');
    vi.mocked(searchExporterProfiles).mockResolvedValue({ profiles: [PROFILE], limit: 50, offset: 0, total: 1 });
    vi.mocked(listSavedLists).mockResolvedValueOnce({
      lists: [
        {
          id: 'c-l1',
          name: 'RXIL prospects',
          object_type: 'COMPANIES',
          filters: { journey: 'PROSPECT', source: 'RXIL' },
          columns: [],
          sort: 'status_since',
          sort_order: 'asc',
          created_by: 'u-admin',
          created_by_name: 'Ada Admin',
          created_at: '2026-09-30T00:00:00Z',
          updated_at: '2026-09-30T00:00:00Z',
          can_edit: false,
        },
      ],
      can_create: false,
    });
    renderPage();
    const group = await screen.findByRole('group', { name: 'Saved lists' });
    fireEvent.click(within(group).getByRole('button', { name: /RXIL prospects/ }));
    await waitFor(() =>
      expect(searchExporterProfiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ journey: 'PROSPECT', source: 'RXIL', sort: 'status_since', order: 'asc' }),
      ),
    );
  });
});
