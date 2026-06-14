/*
 * Public surface of the dashboard feature (the authenticated home summary).
 */
export { DashboardHome } from './components/DashboardHome';
export { useOrgStats } from './api/useOrgStats';
export { useQueueOverview } from './api/useQueueOverview';
export type { OrgStats, QueueOverview, OverviewServiceStatus } from './types';
