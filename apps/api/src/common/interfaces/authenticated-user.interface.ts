export interface IAuthenticatedUser {
  /** User UUID (from JWT "sub" claim) */
  id: string;

  /** User email */
  email: string;

  /** User full name */
  fullName: string;

  /** Organization UUID the user belongs to */
  orgId: string;

  /** User role within the organization */
  role: 'OWNER' | 'ADMIN' | 'STAFF';

  /** Token type identifier */
  type: 'staff';
}

export interface IAuthenticatedCustomer {
  /** Customer UUID (from JWT "sub" claim) */
  id: string;

  /** Token type identifier */
  type: 'customer';
}
