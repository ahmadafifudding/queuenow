import { z } from 'zod';

// ==========================================
// AUTH SCHEMAS
// ==========================================

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters'),
  organizationType: z.enum(['CLINIC', 'BANK', 'RESTAURANT', 'GOVERNMENT', 'OTHER']),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const customerRegisterSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  phone: z.string().optional(),
  fullName: z.string().min(2, 'Name must be at least 2 characters').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const switchOrganizationSchema = z.object({
  orgId: z.string().uuid('Invalid organization ID'),
});

// ==========================================
// ORGANIZATION SCHEMAS
// ==========================================

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  timezone: z.string().optional(),
});

export const updateBrandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color')
    .optional(),
  qrText: z.string().max(255).optional(),
});

// ==========================================
// SERVICE SCHEMAS
// ==========================================

export const createServiceSchema = z.object({
  name: z.string().min(2, 'Service name must be at least 2 characters'),
  prefix: z.string().min(1).max(3, 'Prefix must be 1-3 characters'),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
  maxQueuePerDay: z.number().int().positive().optional(),
  avgServingTime: z.number().int().positive().optional().default(5),
});

export const updateServiceSchema = createServiceSchema.partial();

// ==========================================
// COUNTER SCHEMAS
// ==========================================

export const createCounterSchema = z.object({
  serviceId: z.string().uuid('Invalid service ID'),
  name: z.string().min(1, 'Counter name is required'),
  isActive: z.boolean().optional().default(true),
});

export const updateCounterSchema = createCounterSchema.partial();

// ==========================================
// QUEUE SCHEMAS
// ==========================================

export const joinQueueSchema = z.object({
  serviceId: z.string().uuid('Invalid service ID'),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  customerProfileId: z.string().uuid().optional(),
  deviceFingerprint: z.string().optional(),
});

export const callNextSchema = z.object({
  counterId: z.string().uuid('Invalid counter ID'),
});

// ==========================================
// STAFF SCHEMAS
// ==========================================

export const inviteStaffSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['ADMIN', 'STAFF']).optional().default('STAFF'),
  serviceId: z.string().uuid().optional(),
});

// ==========================================
// SETTINGS SCHEMAS
// ==========================================

export const updateQueueSettingsSchema = z.object({
  resetTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:MM)')
    .optional(),
  maxRecall: z.number().int().min(1).max(5).optional(),
  requireName: z.boolean().optional(),
  requirePhone: z.boolean().optional(),
  autoSkipTimeout: z.number().int().positive().optional(),
});

// ==========================================
// TYPE EXPORTS (inferred from schemas)
// ==========================================

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type CreateCounterInput = z.infer<typeof createCounterSchema>;
export type UpdateCounterInput = z.infer<typeof updateCounterSchema>;
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;
export type CallNextInput = z.infer<typeof callNextSchema>;
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type UpdateQueueSettingsInput = z.infer<typeof updateQueueSettingsSchema>;
