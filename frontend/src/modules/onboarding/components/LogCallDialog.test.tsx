import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getExporterConversation, listExporterActivities, logCall } from '../api';
import type { Conversation, ExporterActivity, ExporterContact } from '../types';

import { LogCallDialog } from './LogCallDialog';

vi.mock('../api', () => ({
  logCall: vi.fn(),
  getExporterConversation: vi.fn(),
  listExporterActivities: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const COMPANY = 'c1';
const ROHAN: ExporterContact = {
  id: 'p1',
  customer_id: COMPANY,
  name: 'Rohan Mehta',
  role: 'Finance head',
  email: 'rohan@bharat.example',
  phone: '+91 22 5550 2222',
  department: null,
  is_primary_contact: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, only the fields read here
} as any;
const PRIYA: ExporterContact = { ...ROHAN, id: 'p2', name: 'Priya Nair', is_primary_contact: false, phone: '••••1111' };

const PAST_CALL: ExporterActivity = {
  id: 'a1',
  customer_id: COMPANY,
  activity_type: 'CALL',
  subject: 'Outgoing call to Rohan Mehta — connected',
  notes: null,
  actor_id: 'u1',
  actor_name: 'Olivia Ops',
  occurred_at: '2026-09-28T09:30:00Z',
  due_at: null,
  created_at: '2026-09-28T09:30:00Z',
  call_direction: 'OUTBOUND',
  call_result: 'CONNECTED',
  call_duration_seconds: 125,
  contact_id: 'p1',
};

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    company_id: COMPANY,
    conversation: 'IN_CONVERSATION',
    check_back_on: null,
    journey: 'PROSPECT',
    allowed_moves: [
      { to: 'READY_NOW', reason_required: false, check_back_required: false },
      { to: 'NOT_NOW', reason_required: true, check_back_required: true },
    ],
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
  } as any;
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <LogCallDialog
        customerId={COMPANY}
        companyName="Bharat Precision Metals"
        contacts={[ROHAN, PRIYA]}
        initialContactId="p1"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getExporterConversation).mockResolvedValue(conversation());
  vi.mocked(listExporterActivities).mockResolvedValue({ customer_id: COMPANY, activities: [PAST_CALL] });
  vi.mocked(logCall).mockResolvedValue({ call: PAST_CALL, follow_up: null, conversation: null });
});

describe('LogCallDialog', () => {
  it('shows who is being called, their number and their past calls', async () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: /Log a call with Rohan Mehta/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\+91 22 5550 2222/ })).toHaveAttribute('href', 'tel:+912255502222');
    const history = await screen.findByRole('region', { name: 'Call history' });
    expect(await within(history).findByText(/Olivia Ops/)).toBeInTheDocument();
    expect(within(history).getByText(/Outgoing 2:05 · Connected/)).toBeInTheDocument();
  });

  it('does not dial a number masked for this role', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Contact'), { target: { value: 'p2' } });
    expect(screen.getByText('••••1111')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /1111/ })).toBeNull();
  });

  it('waits for a result before it can be saved', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Save call' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Call result/), { target: { value: 'NO_ANSWER' } });
    expect(screen.getByRole('button', { name: 'Save call' })).toBeEnabled();
  });

  it('sends the call, a status move and a follow-up in one save', async () => {
    const { onOpenChange } = renderDialog();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ready Now' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: /Incoming/ }));
    fireEvent.change(screen.getByLabelText(/Call result/), { target: { value: 'CONNECTED' } });
    fireEvent.change(screen.getByLabelText('Duration minutes'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Duration seconds'), { target: { value: '05' } });
    fireEvent.change(screen.getByLabelText('Notes about this call'), { target: { value: ' PO confirmed ' } });
    fireEvent.change(screen.getByLabelText('Update status'), { target: { value: 'READY_NOW' } });
    fireEvent.click(screen.getByLabelText('Schedule a follow-up call'));
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-10-05T11:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }));

    await waitFor(() =>
      expect(logCall).toHaveBeenCalledWith(COMPANY, {
        contact_id: 'p1',
        direction: 'INBOUND',
        result: 'CONNECTED',
        duration_seconds: 245,
        notes: 'PO confirmed',
        status: { to: 'READY_NOW', reason: null, check_back_on: null },
        follow_up_at: new Date('2026-10-05T11:30').toISOString(),
        follow_up_subject: null,
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('asks for the reason and check-back date "Not now" needs before saving', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Not Now' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Call result/), { target: { value: 'CONNECTED' } });
    fireEvent.change(screen.getByLabelText('Update status'), { target: { value: 'NOT_NOW' } });

    expect(screen.getByRole('button', { name: 'Save call' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: 'Busy season' } });
    fireEvent.change(screen.getByLabelText(/Check back on/), { target: { value: '2026-11-01' } });
    expect(screen.getByRole('button', { name: 'Save call' })).toBeEnabled();
  });

  it('offers no status change for a lead, which has no conversation yet', async () => {
    vi.mocked(getExporterConversation).mockResolvedValue(conversation({ allowed_moves: [], journey: 'LEAD' }));
    renderDialog();
    expect(await screen.findByText(/a lead has no conversation yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Update status')).toBeDisabled();
  });
});
