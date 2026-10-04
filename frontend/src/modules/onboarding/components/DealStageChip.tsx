/**
 * A deal's stage — **owner: Developer 3B**.
 *
 * The status language applied to a deal: neutral while it is open, blue while
 * paperwork is being gathered, green once handed over, muted once withdrawn —
 * the same grammar every other chip uses, so a reader learns it once.
 */

import { Chip, type ChipTone } from '@/components';

import { DEAL_STAGE_LABEL } from '../constants';
import type { DealStage } from '../types';

const STAGE_LOOK: Record<DealStage, { tone: ChipTone; className?: string }> = {
  OPEN: { tone: 'neutral' },
  GATHERING_PAPERWORK: { tone: 'info' },
  HANDED_OVER: { tone: 'success' },
  WITHDRAWN: { tone: 'neutral', className: 'text-ink-faint' },
};

export function DealStageChip({ stage }: { stage: DealStage }) {
  const look = STAGE_LOOK[stage];
  return (
    <Chip dot tone={look.tone} className={look.className}>
      {DEAL_STAGE_LABEL[stage]}
    </Chip>
  );
}
