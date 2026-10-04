export { JourneyChip, MarkerBadge, QualificationChip } from './CompanyChips';
export { MarkerControl } from './MarkerControl';
export { DuplicatePanMessage } from './DuplicatePanMessage';
export { duplicatePanHolder } from './duplicate-pan';
export { VerificationSection } from './VerificationSection';
// Developer 4B: checks on a deal's buyer, mounted on the deal page.
export { BuyerChecks } from './BuyerChecks';
// Developer 3A: the conversation gauge's move control, and the READY_NOW prompt
// (seam S2), which opens a deal through Developer 3B's `OpenDealForm`.
export { ConversationGaugeControl } from './ConversationGaugeControl';
export { OpenDealPrompt } from './OpenDealPrompt';
// Developer 3B: deals and documents. `DocumentUpload` and `DocumentList` are
// shared by the company page's Documents tab and the deal page, because a
// document row and an upload form read the same wherever they hang;
// `ScanStatusBadge` says which "scanner" reached a verdict.
export { DealStageChip } from './DealStageChip';
export { OpenDealForm } from './OpenDealForm';
export { DocumentList } from './DocumentList';
export { DocumentUpload } from './DocumentUpload';
export { ScanStatusBadge } from './ScanStatusBadge';
// Developer 1: the shared history log, and who acted, by name.
export { CompanyHistory, DealHistory } from './HistoryTimeline';
export { actorLabel } from './actor-label';

// ── Background check — owner: Developer 4A ──
export { BackgroundCheckChip, BackgroundCheckGauge } from './BackgroundCheckGauge';
export { RiskChip } from './RiskChip';
export { BackgroundCheckMoveDialog } from './BackgroundCheckMoveDialog';
export { DecisionHistory } from './DecisionHistory';
export { DealsTable, type DealsSort } from './DealsTable';
export { QueueTable, type QueueColumn, type QueueSort } from './QueueTable';
export { QueueCustomize } from './QueueCustomize';
export { KeyFigures } from './KeyFigures';
export { COMPANY_COLUMNS, type CompanyColumn, type CompanyColumnId } from './company-columns';
export { DEAL_COLUMNS, type DealColumn, type DealColumnId } from './deal-columns';
export { SavedListActions, SavedListTabs, type ListDefinition } from './SavedListBar';
export { LogCallDialog } from './LogCallDialog';
export { CALL_RESULT_LABEL, CALL_RESULTS, formatDuration } from './call-labels';
