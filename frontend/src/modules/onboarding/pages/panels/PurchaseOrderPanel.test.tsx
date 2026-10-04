import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addInvoice, getPurchaseOrder, listDealDocuments, setPurchaseOrder, suggestFields } from '../../api';
import type { DealPaperwork, PurchaseOrder } from '../../types';

import { PurchaseOrderPanel } from './PurchaseOrderPanel';

vi.mock('../../api', () => ({
  getPurchaseOrder: vi.fn(),
  setPurchaseOrder: vi.fn(),
  addInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  removeInvoice: vi.fn(),
  suggestFields: vi.fn(),
  listDealDocuments: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const DEAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const PO: PurchaseOrder = {
  id: 'p1',
  deal_id: DEAL_ID,
  po_number: 'RTB-PO-24-0311',
  po_date: '2026-03-04',
  currency: 'EUR',
  total_amount: '84000.00',
  payment_terms: '60 days from invoice',
  source_document_id: null,
  invoices: [
    {
      id: 'i1',
      purchase_order_id: 'p1',
      invoice_number: 'BPM-INV-0311-A',
      invoice_date: '2026-03-18',
      due_date: '2026-05-17',
      currency: 'EUR',
      amount: '50000.00',
      source_document_id: null,
      created_at: '2026-03-18T00:00:00Z',
      updated_at: '2026-03-18T00:00:00Z',
    },
  ],
  invoiced_amount: '50000.00',
  uninvoiced_amount: '34000.00',
  created_at: '2026-03-04T00:00:00Z',
  updated_at: '2026-03-04T00:00:00Z',
};

function paperwork(po: PurchaseOrder | null, canEdit = true): DealPaperwork {
  return { purchase_order: po, can_edit: canEdit };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PurchaseOrderPanel dealId={DEAL_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDealDocuments).mockResolvedValue({
    documents: [{ id: 'doc1', file_name: 'purchase-order.pdf', category: 'PRE_SHIPMENT', is_downloadable: true }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, only the fields read here
  } as any);
});

describe('PurchaseOrderPanel', () => {
  it('says what is missing before a PO is recorded, and offers to record one', async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(paperwork(null));
    renderPanel();
    expect(await screen.findByText(/No purchase order yet/)).toBeInTheDocument();
    expect(screen.getByText(/not handed over without its PO and at least one invoice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record the PO/ })).toBeInTheDocument();
  });

  it('shows the PO, its invoices and what is left to invoice', async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(paperwork(PO));
    renderPanel();
    expect(await screen.findByText('RTB-PO-24-0311')).toBeInTheDocument();
    expect(screen.getByText('Invoices (1)')).toBeInTheDocument();
    const row = screen.getByTestId('invoice-row');
    expect(within(row).getByText('BPM-INV-0311-A')).toBeInTheDocument();
    expect(within(row).getByText('EUR 50,000.00')).toBeInTheDocument();
    expect(screen.getByText('EUR 34,000.00')).toBeInTheDocument();
  });

  it('gives a viewer the server says may not edit (COMPLIANCE) no controls', async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(paperwork(PO, false));
    renderPanel();
    await screen.findByText('RTB-PO-24-0311');
    expect(screen.queryByRole('button', { name: /Edit PO|Add invoice|Remove invoice/ })).toBeNull();
  });

  it('records a PO, starting blank while no document reader is set up', async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(paperwork(null));
    vi.mocked(suggestFields).mockResolvedValue({ extractor: null, fields: {} });
    vi.mocked(setPurchaseOrder).mockResolvedValue(paperwork({ ...PO, invoices: [] }));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Record the PO/ }));

    await waitFor(() => expect(screen.getByRole('option', { name: 'purchase-order.pdf' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Read from document'), { target: { value: 'doc1' } });
    await waitFor(() => expect(suggestFields).toHaveBeenCalledWith(DEAL_ID, 'doc1', 'purchase_order'));
    expect(screen.getByLabelText(/PO number/)).toHaveValue('');

    fireEvent.change(screen.getByLabelText(/PO number/), { target: { value: 'RTB-PO-24-0311' } });
    fireEvent.change(screen.getByLabelText(/PO date/), { target: { value: '2026-03-04' } });
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'eur' } });
    fireEvent.change(screen.getByLabelText(/Total amount/), { target: { value: '84000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase order' }));

    await waitFor(() =>
      expect(setPurchaseOrder).toHaveBeenCalledWith(DEAL_ID, {
        po_number: 'RTB-PO-24-0311',
        po_date: '2026-03-04',
        currency: 'EUR',
        total_amount: '84000',
        payment_terms: null,
        source_document_id: 'doc1',
      }),
    );
  });

  it('fills the form from a configured reader without overwriting what was typed', async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(paperwork(null));
    vi.mocked(suggestFields).mockResolvedValue({
      extractor: 'textract',
      fields: { po_number: 'READ-1', currency: 'USD', total_amount: '500.00' },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Record the PO/ }));
    fireEvent.change(screen.getByLabelText(/PO number/), { target: { value: 'TYPED-1' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'purchase-order.pdf' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Read from document'), { target: { value: 'doc1' } });

    await waitFor(() => expect(screen.getByLabelText(/Currency/)).toHaveValue('USD'));
    expect(screen.getByLabelText(/PO number/)).toHaveValue('TYPED-1');
    expect(screen.getByLabelText(/Total amount/)).toHaveValue('500.00');
  });

  it('adds an invoice in the currency of the PO', async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(paperwork(PO));
    vi.mocked(addInvoice).mockResolvedValue(paperwork(PO));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Add invoice/ }));
    expect(screen.getByLabelText(/Amount \(EUR\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Invoice number/), { target: { value: 'BPM-INV-0311-B' } });
    fireEvent.change(screen.getByLabelText(/Amount \(EUR\)/), { target: { value: '34000' } });
    fireEvent.change(screen.getByLabelText(/Invoice date/), { target: { value: '2026-03-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add invoice' }));

    await waitFor(() =>
      expect(addInvoice).toHaveBeenCalledWith(DEAL_ID, {
        invoice_number: 'BPM-INV-0311-B',
        invoice_date: '2026-03-25',
        due_date: null,
        amount: '34000',
        source_document_id: null,
      }),
    );
  });
});
