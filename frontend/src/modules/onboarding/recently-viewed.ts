/**
 * Recently viewed companies — Centrex's "Recently viewed" bar, per viewer.
 *
 * A convenience, so it lives in this browser only (never a shared record): the
 * last few companies this person opened, newest first. Every read and write is
 * guarded — private windows and blocked storage just mean an empty bar.
 */

import { useSyncExternalStore } from 'react';

export interface RecentCompany {
  id: string;
  name: string;
}

const KEY = 'aner.companies.recent';
const LIMIT = 8;
const EVENT = 'aner:recent-companies';

function read(): RecentCompany[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RecentCompany => typeof item?.id === 'string' && typeof item?.name === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

let snapshot = read();

/** Put a company at the front of the list (once), keeping the newest `LIMIT`. */
export function rememberCompany(company: RecentCompany): void {
  if (snapshot[0]?.id === company.id && snapshot[0]?.name === company.name) return;
  const next = [company, ...read().filter((item) => item.id !== company.id)].slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not remembered beyond this page view.
  }
  snapshot = next;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  const refresh = () => {
    snapshot = read();
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', refresh);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', refresh);
  };
}

export function useRecentCompanies(): RecentCompany[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
