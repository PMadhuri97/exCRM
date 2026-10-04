import { describe, expect, it } from 'vitest';

import type { DealQueueItem } from '../types';

import { daysOpen, initials, shortId } from './deal-columns';

const BASE: DealQueueItem = {
  id: '3f2a9c1b-0000-4000-8000-000000000000',
  company_id: 'c1',
  company_name: 'Bharat Precision Metals Ltd',
  company_journey: 'CUSTOMER',
  company_background_check: 'CLEAR',
  reference: 'Hamburg order',
  stage: 'OPEN',
  buyer_name: null,
  buyer_country: null,
  handed_over_at: null,
  po_currency: null,
  po_total: null,
  invoice_count: 0,
  invoiced_total: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
};

describe('daysOpen', () => {
  it('counts to now while a deal is live', () => {
    expect(daysOpen(BASE, new Date('2026-09-11T12:00:00Z'))).toBe(10);
  });

  it('stops at the handover', () => {
    expect(
      daysOpen({ ...BASE, stage: 'HANDED_OVER', handed_over_at: '2026-09-04T00:00:00Z' }, new Date('2026-12-01')),
    ).toBe(3);
  });

  it('stops at the withdrawal, its last change', () => {
    expect(daysOpen({ ...BASE, stage: 'WITHDRAWN' }, new Date('2026-12-01'))).toBe(4);
  });
});

describe('initials and shortId', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Bharat Precision Metals Ltd')).toBe('BP');
    expect(initials('Coastal')).toBe('C');
    expect(initials(null)).toBe('?');
  });

  it('shortens the deal id to eight characters', () => {
    expect(shortId(BASE.id)).toBe('3F2A9C1B');
  });
});
