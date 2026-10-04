/**
 * How calls are worded on screen — shared by the call pop-up and the activity
 * timeline. Kept apart from the components (react-refresh's rule).
 */

import type { CallResult } from '../types';

export const CALL_RESULT_LABEL: Record<CallResult, string> = {
  CONNECTED: 'Connected',
  NO_ANSWER: 'No answer',
  VOICEMAIL: 'Left a voicemail',
  BUSY: 'Busy',
  WRONG_NUMBER: 'Wrong number',
  CALL_BACK_REQUESTED: 'Asked to be called back',
};
export const CALL_RESULTS = Object.keys(CALL_RESULT_LABEL) as CallResult[];

/** "4:05" — minutes and seconds, as Centrex shows a call's length. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
