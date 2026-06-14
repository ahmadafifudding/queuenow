/*
 * Public surface of the staff feature (R10). Routes and other modules import
 * from here rather than reaching into internals.
 */

// Top-level view + composition pieces.
export { StaffManagementView } from './components/StaffManagementView';
export type { StaffManagementViewProps } from './components/StaffManagementView';
export { StaffTable } from './components/StaffTable';
export type { StaffTableProps } from './components/StaffTable';
export { StaffPager } from './components/StaffPager';
export type { StaffPagerProps } from './components/StaffPager';
export { InviteStaffForm } from './components/InviteStaffForm';
export type { InviteStaffFormProps } from './components/InviteStaffForm';

// API hooks.
export { useStaffList } from './api/useStaffList';
export type { UseStaffListOptions } from './api/useStaffList';
export { useInviteStaff } from './api/useInviteStaff';
export type { UseInviteStaffOptions } from './api/useInviteStaff';
export { staffEndpoints } from './api/endpoints';
export type { StaffListQuery } from './api/endpoints';

// Search-param parsing (route pagination, Property 15).
export { DEFAULT_STAFF_PAGE, STAFF_PAGE_SIZE, parsePage, validateStaffSearch } from './lib/search';
export type { StaffSearch } from './lib/search';

// Normalization helpers.
export { derivePagination, normalizeStaffList } from './lib/normalize';

// Types.
export type { StaffInvitation, StaffListResult, StaffMember, StaffPagination } from './types';
