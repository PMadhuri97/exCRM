/**
 * The background-check gauge — **owner: Developer 4A** (L4-03, L4-08).
 *
 * The six values of `background-check.md` §2, and nothing inferred from them. In
 * particular `NOT_STARTED` says **"Not started"**, never "pending" or "clear": no
 * check has run, and a screen that implies one has is the exact failure the
 * pass-through scanner warnings exist to prevent.
 */

import { Chip, type ChipTone } from '@/components';

import type { BackgroundCheckState } from '../types';

import { BACKGROUND_CHECK_LABEL } from './background-check-labels';

const STYLES: Record<BackgroundCheckState, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  IN_REVIEW: 'bg-blue-50 text-blue-700 ring-blue-700/20',
  MORE_INFO: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  CLEAR: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  FLAGGED: 'bg-red-50 text-red-700 ring-red-600/20',
  ON_HOLD: 'bg-orange-50 text-orange-800 ring-orange-600/30',
};

/** What each value means, in a sentence, so nobody has to guess. */
const DESCRIPTIONS: Record<BackgroundCheckState, string> = {
  NOT_STARTED: 'No background check has been started for this company.',
  IN_REVIEW: 'Compliance is reviewing checks, screening items and documents.',
  MORE_INFO: 'Compliance has asked for something specific before it can continue.',
  CLEAR: 'Compliance has cleared this company, with a risk rating and a recorded reason.',
  FLAGGED: 'A concern has been raised. Deals cannot be handed over.',
  ON_HOLD: 'A flagged company put on hold. Deals cannot be handed over.',
};

export function BackgroundCheckGauge({ value }: { value: BackgroundCheckState }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        data-testid="background-check-gauge"
        data-value={value}
        className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-sm font-medium ring-1 ring-inset ${STYLES[value]}`}
      >
        {BACKGROUND_CHECK_LABEL[value]}
      </span>
      <p className="text-xs text-slate-500">{DESCRIPTIONS[value]}</p>
    </div>
  );
}

const CHIP_TONE: Record<BackgroundCheckState, ChipTone> = {
  NOT_STARTED: 'neutral',
  IN_REVIEW: 'info',
  MORE_INFO: 'warning',
  CLEAR: 'success',
  FLAGGED: 'danger',
  ON_HOLD: 'danger',
};

/** The same value as the gauge, sized for a table row: the label only, with the
 * sentence as a tooltip. */
export function BackgroundCheckChip({ value }: { value: BackgroundCheckState }) {
  return (
    <Chip dot tone={CHIP_TONE[value]} title={DESCRIPTIONS[value]}>
      {BACKGROUND_CHECK_LABEL[value]}
    </Chip>
  );
}
