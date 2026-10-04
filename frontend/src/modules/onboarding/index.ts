// modules/onboarding — public facade.
// Other modules import ONLY from here.
export { CompanyRoutes, LegacyExporterRoutes } from './routes';
export {
  DealsListPage,
  DealDetailPage,
  FollowUpsPage,
  PipelinePage,
  QualificationCriteriaPage,
} from './pages';
export { COMPANY_TABS, paths, type CompanyTab } from './paths';
// The Home page's cards: domain views composed by `src/pages/HomePage.tsx`.
export { CheckBacksDueCard, FollowUpsDueCard, PipelineSummaryCard } from './components/home';
// The key figures strip, shared with the Deals list (build prompt chunk 0.5).
export { KeyFigures } from './components/KeyFigures';
